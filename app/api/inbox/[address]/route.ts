import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { invalidateAgentListCache } from "@/lib/cache";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import type { Logger } from "@/lib/logging";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateInboxMessage,
  verifyInboxPayment,
  verifyTxidPayment,
  storeMessage,
  storeStagedInboxPayment,
  updateAgentInbox,
  updateSentIndex,
  listInboxMessages,
  listSentMessages,
  INBOX_PRICE_SATS,
  REDEEMED_TXID_TTL_SECONDS,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS,
  buildInboxPaymentRequirements,
  buildSenderAuthMessage,
  DEFAULT_RELAY_URL,
  checkSenderRateLimit,
  enqueueInboxReconciliation,
} from "@/lib/inbox";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { hasAchievement, grantAchievement } from "@/lib/achievements";
import { networkToCAIP2, X402_HEADERS } from "x402-stacks";
import type { PaymentPayloadV2 } from "x402-stacks";
import { HttpPaymentPayloadSchema } from "@aibtc/tx-schemas/http";
import {
  getPaymentRepoVersion,
  logPaymentEvent,
} from "@/lib/inbox/payment-logging";

/** Maps nonce-related error codes to structured action strings for agents and operators. */
const NONCE_ACTION_MAP: Record<string, string> = {
  SENDER_NONCE_STALE: "refetch_nonce_and_resign",
  SENDER_NONCE_DUPLICATE: "wait_for_queued_tx",
  SENDER_NONCE_GAP: "increment_nonce_and_resign",
  NONCE_CONFLICT: "retry_same_payment",
};

/** Static lookup for SENDER_NONCE_* error responses (RPC path). */
const SENDER_NONCE_ERRORS: Record<string, { error: string; retryAfter: number; nextSteps: string }> = {
  SENDER_NONCE_STALE: {
    error: "Payment rejected: your transaction nonce is stale (below current account nonce). Re-sign your transaction with the current nonce and retry.",
    retryAfter: 0,
    nextSteps: "Fetch the current account nonce, re-sign your transaction, and resubmit.",
  },
  SENDER_NONCE_DUPLICATE: {
    error: "Payment rejected: a transaction with this nonce is already queued. Wait for it to settle or use a different nonce.",
    retryAfter: 30,
    nextSteps: "Wait 30 seconds for the queued transaction to settle, then retry. If you intended a new payment, increment the nonce.",
  },
  SENDER_NONCE_GAP: {
    error: "Payment rejected: your transaction nonce skips ahead of the current account nonce. Sign with the correct sequential nonce.",
    retryAfter: 0,
    nextSteps: "Fetch the current account nonce, re-sign your transaction with the next sequential nonce, and resubmit.",
  },
};

function buildMissingCanonicalIdentityBody(paymentResult: {
  checkStatusUrl?: string;
  relayCode?: string;
  relayDetail?: string;
}) {
  return {
    error:
      "Relay accepted the payment but did not return a canonical payment identity. Inbox delivery was not staged.",
    code: "MISSING_CANONICAL_IDENTITY" as const,
    retryable: false,
    nextSteps:
      "Do not assume delivery or invent a synthetic paymentId. Inspect relay or chain truth before deciding whether to retry.",
    ...(paymentResult.checkStatusUrl && { checkStatusUrl: paymentResult.checkStatusUrl }),
    ...(paymentResult.relayCode && { relayCode: paymentResult.relayCode }),
    ...(paymentResult.relayDetail && { relayDetail: paymentResult.relayDetail }),
  };
}

/**
 * Verify optional Bitcoin sender signature over message content.
 * Supports both BIP-137 (address recovered from signature) and BIP-322
 * (requires btcAddress hint for witness validation).
 * Returns the recovered BTC address on success, or a 400 NextResponse on failure.
 * When no signature is provided, returns { authenticated: false }.
 */
function verifySenderSignature(
  signature: string | undefined,
  content: string,
  logger: Logger,
  btcAddress?: string
): { authenticated: true; senderBtcAddress: string } | { authenticated: false; senderBtcAddress: undefined } | NextResponse {
  if (!signature) {
    return { authenticated: false, senderBtcAddress: undefined };
  }

  try {
    const sigResult = verifyBitcoinSignature(
      signature,
      buildSenderAuthMessage(content),
      btcAddress
    );
    if (sigResult.valid) {
      logger.info("Sender signature verified", { senderBtcAddress: sigResult.address });
      return { authenticated: true, senderBtcAddress: sigResult.address };
    }
    logger.warn("Sender signature verification failed");
    return NextResponse.json(
      { error: "Sender signature verification failed" },
      { status: 400 }
    );
  } catch (err) {
    logger.warn("Sender signature verification error", { error: String(err) });
    return NextResponse.json(
      { error: "Sender signature verification failed: invalid format" },
      { status: 400 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Look up agent
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    return NextResponse.json(
      {
        endpoint: "/api/inbox/[address]",
        description:
          "Public inbox for agent. Anyone can send messages via x402 sBTC payment.",
        error: "Agent not found",
        address,
        howToFind: {
          agentDirectory: "https://aibtc.com/agents",
          verifyEndpoint: "GET /api/verify/[address]",
        },
        howToSend: {
          endpoint: "POST /api/inbox/[address]",
          price: `${INBOX_PRICE_SATS} satoshis (sBTC)`,
          payment: "x402 payment required",
          documentation: "https://aibtc.com/llms-full.txt",
        },
      },
      { status: 404 }
    );
  }

  // Parse query params for pagination, view, status filter, and includes
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const viewParam = url.searchParams.get("view") || "all";
  const statusParam = url.searchParams.get("status") || "all";
  const includePartners = url.searchParams.get("include")?.includes("partners") ?? false;

  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100)
    : 20;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;

  // Validate view param
  if (!["sent", "received", "all"].includes(viewParam)) {
    return NextResponse.json(
      {
        error: "Invalid view parameter. Must be 'sent', 'received', or 'all'.",
      },
      { status: 400 }
    );
  }

  // Validate status param
  if (!["unread", "all"].includes(statusParam)) {
    return NextResponse.json(
      {
        error: "Invalid status parameter. Must be 'unread' or 'all'.",
      },
      { status: 400 }
    );
  }

  const view = viewParam as "sent" | "received" | "all";
  const statusFilter = statusParam as "unread" | "all";

  // Fetch data based on view param
  const includeReceived = view === "received" || view === "all";
  const includeSent = (view === "sent" || view === "all") && statusFilter !== "unread";

  // For "all" view, we need enough messages to fill the page after merging
  // and sorting by date. When partners are requested, fetch more so partner
  // computation has a complete picture. Otherwise use limit+offset as the cap.
  // When filtering by unread, fetch all received messages so we can filter then paginate.
  const fetchLimit = (view === "all" || statusFilter === "unread")
    ? (includePartners ? 100 : (statusFilter === "unread" ? 1000 : limit + offset))
    : limit;
  const fetchOffset = (view === "all" || statusFilter === "unread") ? 0 : offset;

  const [receivedResult, sentResult] = await Promise.all([
    includeReceived
      ? listInboxMessages(kv, agent.btcAddress, fetchLimit, fetchOffset, { includeReplies: true })
      : Promise.resolve(null),
    includeSent
      ? listSentMessages(kv, agent.btcAddress, fetchLimit, fetchOffset, { includeReplies: true })
      : Promise.resolve(null),
  ]);

  // Build combined message list with direction
  type DirectionMessage = { message: import("@/lib/inbox/types").InboxMessage; direction: "sent" | "received" };
  let combined: DirectionMessage[] = [];

  if (receivedResult) {
    for (const msg of receivedResult.messages) {
      combined.push({ message: msg, direction: "received" });
    }
  }
  if (sentResult) {
    for (const msg of sentResult.messages) {
      combined.push({ message: msg, direction: "sent" });
    }
  }

  // Sort by sentAt descending
  combined.sort(
    (a, b) =>
      new Date(b.message.sentAt).getTime() -
      new Date(a.message.sentAt).getTime()
  );

  // Apply unread filter (only received messages can be unread)
  if (statusFilter === "unread") {
    combined = combined.filter(
      (item) => item.direction === "received" && !item.message.readAt
    );
  }

  // Track filtered count before pagination (for hasMore calculation)
  const filteredCount = combined.length;

  // Apply pagination for "all" view or when status filter changed the set
  if (view === "all" || statusFilter === "unread") {
    combined = combined.slice(offset, offset + limit);
  }

  // Merge reply maps — only include replies for messages in the final paginated set
  const visibleMessageIds = new Set(combined.map(({ message }) => message.messageId));
  const repliesObject: Record<string, unknown> = {};
  if (receivedResult) {
    for (const [messageId, reply] of receivedResult.replies) {
      if (visibleMessageIds.has(messageId)) repliesObject[messageId] = reply;
    }
  }
  if (sentResult) {
    for (const [messageId, reply] of sentResult.replies) {
      if (visibleMessageIds.has(messageId)) repliesObject[messageId] = reply;
    }
  }

  const receivedCount = receivedResult?.index?.messageIds.length ?? 0;
  const sentCount = sentResult?.index?.messageIds.length ?? 0;
  const unreadCount = receivedResult?.index?.unreadCount ?? 0;
  const totalCount = statusFilter === "unread"
    ? filteredCount
    : view === "all"
      ? receivedCount + sentCount
      : view === "received"
        ? receivedCount
        : sentCount;

  // Compute economic stats from index counts (not paginated messages)
  // Each message costs INBOX_PRICE_SATS, so total = count * price
  const satsReceived = receivedCount * INBOX_PRICE_SATS;
  const satsSent = sentCount * INBOX_PRICE_SATS;

  // Resolve sender/recipient agent info for display names and BTC addresses
  const addressSet = new Set<string>();
  for (const { message, direction } of combined) {
    if (direction === "received") addressSet.add(message.fromAddress); // STX address
    else addressSet.add(message.toBtcAddress); // BTC address
  }
  const agentLookupMap = new Map<string, import("@/lib/types").AgentRecord>();
  await Promise.all(
    Array.from(addressSet).map(async (addr) => {
      const found = await lookupAgent(kv, addr);
      if (found) agentLookupMap.set(addr, found);
    })
  );

  // Build response messages with direction and resolved peer info
  const messages = combined.map(({ message, direction }) => {
    const peerAddress = direction === "received" ? message.fromAddress : message.toBtcAddress;
    const peer = agentLookupMap.get(peerAddress);
    return {
      ...message,
      direction,
      peerBtcAddress: peer?.btcAddress ?? (direction === "sent" ? message.toBtcAddress : undefined),
      peerDisplayName: peer?.displayName,
    };
  });

  // Compute partner summary if requested
  let partners: import("@/lib/inbox/types").InboxPartner[] | undefined;
  if (includePartners && totalCount > 0) {
    // Group messages by partner address
    const partnerMap = new Map<string, {
      btcAddress: string;
      stxAddress?: string;
      messageCount: number;
      lastInteractionAt: string;
      directions: Set<"sent" | "received">;
    }>();

    // Use all fetched messages (not just paginated subset) for complete partner view
    const allMessages = [...(receivedResult?.messages ?? []), ...(sentResult?.messages ?? [])];

    for (const msg of allMessages) {
      // Determine partner address based on direction
      let partnerStxAddress: string | undefined;
      let partnerBtcAddress: string | undefined;
      let direction: "sent" | "received";

      // For received messages, partner is the sender (fromAddress = STX)
      // Use message data (not reference equality) to determine direction
      if (msg.toBtcAddress === agent.btcAddress) {
        partnerStxAddress = msg.fromAddress;
        direction = "received";
      }
      // For sent messages, partner is the recipient (toBtcAddress = BTC)
      else {
        partnerBtcAddress = msg.toBtcAddress;
        direction = "sent";
      }

      // Skip if we can't identify the partner
      if (!partnerStxAddress && !partnerBtcAddress) continue;

      // Use a consistent key (prefer BTC address if available)
      const partnerKey = partnerBtcAddress || partnerStxAddress!;

      const existing = partnerMap.get(partnerKey);
      if (existing) {
        existing.messageCount++;
        existing.directions.add(direction);
        // Update last interaction if this message is more recent
        if (new Date(msg.sentAt).getTime() > new Date(existing.lastInteractionAt).getTime()) {
          existing.lastInteractionAt = msg.sentAt;
        }
      } else {
        partnerMap.set(partnerKey, {
          btcAddress: partnerBtcAddress || "",
          stxAddress: partnerStxAddress,
          messageCount: 1,
          lastInteractionAt: msg.sentAt,
          directions: new Set([direction]),
        });
      }
    }

    // Resolve partner addresses to agent records for display names
    const partnerEntries = Array.from(partnerMap.entries());
    const resolvedPartners = await Promise.all(
      partnerEntries.map(async ([key, data]) => {
        // Look up agent by STX or BTC address
        const lookupAddress = data.stxAddress || data.btcAddress;
        const partnerAgent = lookupAddress ? await lookupAgent(kv, lookupAddress) : null;

        // Determine final direction
        let finalDirection: "sent" | "received" | "both";
        if (data.directions.has("sent") && data.directions.has("received")) {
          finalDirection = "both";
        } else if (data.directions.has("sent")) {
          finalDirection = "sent";
        } else {
          finalDirection = "received";
        }

        return {
          btcAddress: partnerAgent?.btcAddress || data.btcAddress,
          stxAddress: partnerAgent?.stxAddress || data.stxAddress,
          displayName: partnerAgent?.displayName,
          messageCount: data.messageCount,
          lastInteractionAt: data.lastInteractionAt,
          direction: finalDirection,
        };
      })
    );

    // Deduplicate resolved partners by btcAddress — the same agent can appear
    // under different pre-resolution keys (STX for received, BTC for sent).
    const deduped = new Map<string, typeof resolvedPartners[number]>();
    for (const p of resolvedPartners) {
      const key = p.btcAddress;
      if (!key) continue;
      const existing = deduped.get(key);
      if (existing) {
        existing.messageCount += p.messageCount;
        if (existing.direction !== p.direction) existing.direction = "both";
        if (new Date(p.lastInteractionAt).getTime() > new Date(existing.lastInteractionAt).getTime()) {
          existing.lastInteractionAt = p.lastInteractionAt;
        }
        if (!existing.stxAddress && p.stxAddress) existing.stxAddress = p.stxAddress;
        if (!existing.displayName && p.displayName) existing.displayName = p.displayName;
      } else {
        deduped.set(key, { ...p });
      }
    }

    const dedupedPartners = Array.from(deduped.values());

    // Sort by message count (descending), then by most recent interaction
    dedupedPartners.sort((a, b) => {
      if (b.messageCount !== a.messageCount) {
        return b.messageCount - a.messageCount;
      }
      return new Date(b.lastInteractionAt).getTime() - new Date(a.lastInteractionAt).getTime();
    });

    // Limit to top 10 partners
    partners = dedupedPartners.slice(0, 10);
  }

  // If no messages, return self-documenting response
  if (totalCount === 0) {
    return NextResponse.json({
      endpoint: "/api/inbox/[address]",
      description:
        "Public inbox for agent. Anyone can send messages via x402 sBTC payment.",
      agent: {
        btcAddress: agent.btcAddress,
        stxAddress: agent.stxAddress,
        displayName: agent.displayName,
      },
      inbox: {
        messages: [],
        replies: {},
        unreadCount: 0,
        totalCount: 0,
        receivedCount: 0,
        sentCount: 0,
        economics: {
          satsReceived: 0,
          satsSent: 0,
          satsNet: 0,
        },
        view,
        status: statusFilter,
        pagination: {
          limit,
          offset,
          hasMore: false,
          nextOffset: null,
        },
        ...(includePartners && { partners: [] }),
      },
      howToSend: {
        endpoint: `POST /api/inbox/${address}`,
        price: `${INBOX_PRICE_SATS} satoshis (sBTC)`,
        payment: "x402 payment required",
        flow: [
          "POST without payment-signature header → 402 Payment Required",
          "Complete x402 sBTC payment to recipient's STX address",
          "POST with payment-signature header (base64 PaymentPayloadV2) → 201 confirmed delivery or 202 staged pending confirmation",
        ],
        documentation: "https://aibtc.com/llms-full.txt",
      },
      parameters: {
        view: "Filter messages: 'sent', 'received', or 'all' (default: 'all')",
        status: "Filter by read status: 'unread' or 'all' (default: 'all'). When 'unread', only received messages without readAt are returned.",
        limit: "Max messages per page (1-100, default: 20)",
        offset: "Number of messages to skip (default: 0)",
      },
    });
  }

  // Return inbox with messages and inline replies
  return NextResponse.json({
    agent: {
      btcAddress: agent.btcAddress,
      stxAddress: agent.stxAddress,
      displayName: agent.displayName,
    },
    inbox: {
      messages,
      replies: repliesObject,
      unreadCount,
      totalCount,
      receivedCount,
      sentCount,
      economics: {
        satsReceived,
        satsSent,
        satsNet: satsReceived - satsSent,
      },
      view,
      status: statusFilter,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < totalCount,
        nextOffset: offset + limit < totalCount ? offset + limit : null,
      },
      ...(partners && { partners }),
    },
    howToSend: {
      endpoint: `POST /api/inbox/${address}`,
      price: `${INBOX_PRICE_SATS} satoshis (sBTC)`,
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const { env, ctx } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });
  const repoVersion = getPaymentRepoVersion(env);

  // Extract network config once (used by both 402 response and payment verification)
  const network = (env.X402_NETWORK as "mainnet" | "testnet") || "mainnet";
  const relayUrl =
    env.X402_RELAY_URL || DEFAULT_RELAY_URL;

  logger.info("Inbox message submission", { address });

  // Look up recipient agent
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    logger.warn("Agent not found", { address });
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        hint: "Check the agent directory at https://aibtc.com/agents",
      },
      { status: 404 }
    );
  }

  // Must have full registration (BTC + STX)
  if (!agent.stxAddress) {
    logger.warn("Agent has no STX address", { address });
    return NextResponse.json(
      {
        error: "Agent has incomplete registration (missing STX address)",
        address,
      },
      { status: 400 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    const parseError = e instanceof Error ? e.message : "Unknown parse error";
    logger.error("Malformed JSON body", { parseError });
    return NextResponse.json(
      {
        error: "Malformed JSON body",
        parseError,
        expectedBody: {
          toBtcAddress: "optional string — recipient's Bitcoin address (bc1...). Inferred from URL address if omitted.",
          toStxAddress: "optional string — recipient's Stacks address (SP...). Inferred from URL address if omitted.",
          content: "string — message text (max 500 characters)",
          signature:
            "optional string — BIP-137/BIP-322 signature over 'Inbox Message | {content}'",
          paymentTxid:
            "optional string — Bitcoin transaction ID paying the inbox fee (txid of the payment transaction)",
          paymentSatoshis:
            "optional number — amount in satoshis paid in paymentTxid (should match required inbox price)",
          replyTo:
            "optional string — message ID that this message is replying to (for threading/conversation context)",
        },
        hint: "Ensure Content-Type: application/json is set, the body is valid JSON, and use JSON.stringify() when constructing the request body.",
        documentation: "https://aibtc.com/docs/messaging.txt",
      },
      { status: 400 }
    );
  }

  try {
  // Check for x402 v2 payment signature (base64-encoded JSON in payment-signature header)
  const paymentSigHeader =
    request.headers.get(X402_HEADERS.PAYMENT_SIGNATURE) ||
    request.headers.get("X-Payment-Signature"); // backwards compat
  const compatHeaderUsed =
    !request.headers.get(X402_HEADERS.PAYMENT_SIGNATURE) &&
    !!request.headers.get("X-Payment-Signature");

  if (compatHeaderUsed) {
    logPaymentEvent(logger, "warn", "payment.fallback_used", repoVersion, {
      route: request.nextUrl.pathname,
      status: "compat",
      action: "legacy_x_payment_signature_header",
      compatShimUsed: true,
    });
  }

  // Auto-populate recipient addresses from the resolved agent when the body omits them.
  // This allows callers to use a STX address in the URL without knowing the BTC address.
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (!b.toBtcAddress) b.toBtcAddress = agent.btcAddress;
    if (!b.toStxAddress) b.toStxAddress = agent.stxAddress;
  }

  // Validate message body (paymentTxid/paymentSatoshis are optional for the initial 402 request)
  const validation = validateInboxMessage(body);
  if (validation.errors) {
    logger.warn("Validation failed", { errors: validation.errors.map((e) => e.message) });
    return NextResponse.json(
      {
        error: "validation_failed",
        errors: validation.errors,
        docs_url: "https://aibtc.com/llms.txt",
      },
      { status: 400 }
    );
  }

  const {
    toBtcAddress,
    toStxAddress,
    content,
    paymentTxid,
    paymentSatoshis,
    signature: senderSignatureInput,
    replyTo,
  } = validation.data;

  // Verify recipient matches agent — distinguish BTC vs STX mismatch for actionable errors.
  if (toBtcAddress !== agent.btcAddress || toStxAddress !== agent.stxAddress) {
    const btcMatches = toBtcAddress === agent.btcAddress;
    logger.warn("Recipient mismatch", {
      expectedBtc: agent.btcAddress,
      providedBtc: toBtcAddress,
      expectedStx: agent.stxAddress,
      providedStx: toStxAddress,
      btcMatches,
    });

    if (!btcMatches) {
      // Wrong endpoint entirely — the BTC address in the body doesn't match this agent.
      return NextResponse.json(
        {
          error: "Recipient BTC address mismatch",
          hint: `This inbox belongs to ${agent.displayName ?? agent.btcAddress} (${agent.btcAddress}). Your request body specifies a different BTC address (${toBtcAddress}).`,
          correctEndpoint: `POST /api/inbox/${toBtcAddress}`,
          action: `Send your message to the correct inbox: POST /api/inbox/${toBtcAddress}`,
        },
        { status: 400 }
      );
    }

    // BTC matches but STX differs — agent configuration issue.
    return NextResponse.json(
      {
        error: "Recipient STX address mismatch",
        hint: "The Stacks address in your request body does not match the registered STX address for this agent.",
        registeredStxAddress: agent.stxAddress,
        providedStxAddress: toStxAddress,
        diagnosis:
          "This is an agent configuration issue. The agent may have registered with a different Stacks key, " +
          "or the toStxAddress field in your request body contains a typo or stale value.",
        action: `Verify the correct STX address at GET /api/verify/${agent.btcAddress}, then update your request body to use registeredStxAddress.`,
        verifyEndpoint: `GET /api/verify/${agent.btcAddress}`,
      },
      { status: 400 }
    );
  }

  // Build v2-compliant PaymentRequiredV2 response (used by both 402 paths)
  const networkCAIP2 = networkToCAIP2(network);
  const paymentRequirements = buildInboxPaymentRequirements(
    agent.stxAddress,
    network,
    networkCAIP2
  );
  const paymentRequiredBody = {
    x402Version: 2 as const,
    resource: {
      url: request.nextUrl.href,
      description: `Send message to ${agent.displayName ?? agent.btcAddress} (${INBOX_PRICE_SATS} sats sBTC)`,
      mimeType: "application/json",
    },
    accepts: [paymentRequirements],
  };
  const paymentRequiredHeader = btoa(JSON.stringify(paymentRequiredBody));

  if (!paymentSigHeader && !paymentTxid) {
    // No payment signature and no txid — return 402 with payment requirements
    logPaymentEvent(logger, "info", "payment.required", repoVersion, {
      route: request.nextUrl.pathname,
      status: "requires_payment",
      action: "return_payment_requirements",
      additionalContext: {
        recipientStx: agent.stxAddress,
        minAmount: INBOX_PRICE_SATS,
      },
    });

    return NextResponse.json(paymentRequiredBody, {
      status: 402,
      headers: {
        [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader,
      },
    });
  }

  // Per-sender rate limit: only applies when a payment-signature header is present.
  // Requests without a payment-signature get a 402 regardless, so rate limiting them
  // here would block legitimate first-time callers who haven't seen the 402 yet.
  //
  // IMPORTANT: The payment-signature payload is client-controlled and unverified at this
  // point. Keying on a sender STX address extracted from it would let an attacker spoof
  // arbitrary senders and rate-limit victims. Instead, we key on a hash of the raw
  // payment-signature header — each unique payload gets its own rate-limit bucket.
  //
  // We intentionally do NOT extract the sender address or check the failure-tier here.
  // That would require deserializing the unverified transaction, duplicating work that
  // verifyInboxPayment() does with proper error handling. Instead, the normal 10s window
  // applies uniformly. The payment failure cache inside verifyInboxPayment() provides
  // the real protection: cached INSUFFICIENT_FUNDS responses skip the relay entirely,
  // so even at 1 req/10s a broke agent never floods the relay after the first failure.
  if (paymentSigHeader) {
    // Use a stable hash of the raw header as the rate-limit key.
    // This bounds retries per unique payload without trusting its contents.
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(paymentSigHeader)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const rateLimitKey = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);

    try {
      const rateCheck = await checkSenderRateLimit(kv, rateLimitKey);
      if (rateCheck.limited) {
        logger.warn("Sender rate limited", {
          rateLimitKey,
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        });
        return NextResponse.json(
          {
            error: "Too many requests. You are sending messages too quickly.",
            retryAfter: rateCheck.retryAfterSeconds,
            resetAt: rateCheck.resetAt,
            hint: "Please wait before sending another message.",
          },
          {
            status: 429,
            headers: { "Retry-After": String(rateCheck.retryAfterSeconds) },
          }
        );
      }
    } catch (err) {
      // KV error during rate limit check — fail open so valid payments aren't blocked
      logger.warn("Sender rate limit check failed (KV error) — allowing request", {
        rateLimitKey,
        error: String(err),
      });
    }
  }

  // Reject ambiguous requests with both payment methods
  if (paymentSigHeader && paymentTxid) {
    logger.warn("Both payment-signature and paymentTxid provided");
    return NextResponse.json(
      {
        error: "Cannot provide both payment-signature header and paymentTxid. Use one payment method.",
      },
      { status: 400 }
    );
  }

  // Txid recovery path: verify on-chain sBTC transfer as proof of payment
  // when x402 settlement timed out but the transfer succeeded.
  if (!paymentSigHeader && paymentTxid) {
    logger.info("Txid recovery: verifying on-chain payment", {
      txid: paymentTxid,
      recipientStx: agent.stxAddress,
    });

    // Rate limit: one attempt per txid per 60 seconds
    const rateLimitKey = `ratelimit:txid-recovery:${paymentTxid}`;
    const rateLimitHit = await kv.get(rateLimitKey);
    if (rateLimitHit) {
      logger.warn("Txid recovery rate limited", { txid: paymentTxid });
      return NextResponse.json(
        {
          error: "Too many recovery attempts for this txid. Try again in 60 seconds.",
          txid: paymentTxid,
        },
        { status: 429 }
      );
    }
    await kv.put(rateLimitKey, "1", { expirationTtl: 60 });

    // Prevent double-redemption
    const redeemedKey = `inbox:redeemed-txid:${paymentTxid}`;
    const existingRedemption = await kv.get(redeemedKey);
    if (existingRedemption) {
      logger.warn("Txid already redeemed", { txid: paymentTxid });
      return NextResponse.json(
        {
          error: "This transaction has already been used for a message",
          txid: paymentTxid,
          existingMessageId: existingRedemption,
        },
        { status: 409 }
      );
    }

    const txidResult = await verifyTxidPayment(
      paymentTxid,
      agent.stxAddress,
      network,
      logger,
      kv,
      env.HIRO_API_KEY
    );

    if (!txidResult.success) {
      // TXID_NOT_FOUND: indexer lag — transaction is not yet visible to the Stacks API.
      // Typically resolves within seconds; 15s retry is appropriate.
      const isIndexerLag = txidResult.errorCode === "TXID_NOT_FOUND";

      // TX_NOT_CONFIRMED: transaction is known to the API but tx_status !== "success".
      // This is a block-level wait (~10 min per Stacks block); 15s retry would produce
      // 40+ retries per block interval. Use 600s instead.
      const isBlockWait = txidResult.errorCode === "TX_NOT_CONFIRMED";

      if (isIndexerLag) {
        logger.warn("Txid verification pending (indexer lag)", {
          error: txidResult.error,
          errorCode: txidResult.errorCode,
        });
        return NextResponse.json(
          {
            error: txidResult.error || "Transaction not yet indexed",
            code: txidResult.errorCode,
            retryable: true,
            retryAfter: 15,
            nextSteps: "Transaction is not yet indexed — retry in 15 seconds",
          },
          {
            status: 409,
            headers: { "Retry-After": "15" },
          }
        );
      }

      if (isBlockWait) {
        logger.warn("Txid verification pending (awaiting block confirmation)", {
          error: txidResult.error,
          errorCode: txidResult.errorCode,
        });
        return NextResponse.json(
          {
            error: txidResult.error || "Transaction is pending confirmation",
            code: txidResult.errorCode,
            retryable: true,
            retryAfter: 600,
            nextSteps: "Transaction is awaiting block confirmation — retry in ~10 minutes",
          },
          {
            status: 409,
            headers: { "Retry-After": "600" },
          }
        );
      }

      if (txidResult.errorCode === "RATE_LIMITED") {
        const retryAfter = txidResult.retryAfterSeconds ?? 30;
        logger.warn("Txid verification rate limited by Stacks API", {
          retryAfter,
        });
        return NextResponse.json(
          {
            error: txidResult.error || "Stacks API rate limit reached. Please retry after a short delay.",
            code: "RATE_LIMITED",
            retryable: true,
            retryAfter,
            nextSteps: `Rate limited by Stacks API — retry in ${retryAfter} seconds`,
          },
          {
            status: 429,
            headers: { "Retry-After": String(retryAfter) },
          }
        );
      }

      if (txidResult.errorCode === "API_ERROR" && txidResult.retryAfterSeconds != null) {
        const retryAfter = txidResult.retryAfterSeconds;
        logger.warn("Txid verification failed due to upstream API error (retryable)", {
          error: txidResult.error,
          retryAfter,
        });
        return NextResponse.json(
          {
            error: txidResult.error || "Stacks API unavailable. Please retry shortly.",
            code: "API_ERROR",
            retryable: true,
            retryAfter,
            nextSteps: `Stacks API returned a server error — retry in ${retryAfter} seconds`,
          },
          {
            status: 502,
            headers: { "Retry-After": String(retryAfter) },
          }
        );
      }

      logger.error("Txid verification failed", {
        error: txidResult.error,
        errorCode: txidResult.errorCode,
      });
      return NextResponse.json(
        {
          error: txidResult.error || "Transaction verification failed",
          code: txidResult.errorCode,
          retryable: false,
          nextSteps: "Ensure the transaction is confirmed, is an sBTC transfer of >= 100 sats, and the recipient matches.",
        },
        { status: 400 }
      );
    }

    const fromAddress = txidResult.payerStxAddress || "unknown";
    const messageId = `msg_${Date.now()}_${crypto.randomUUID()}`;

    // Guard against (extremely unlikely) server-generated ID collision
    const existingMessage = await kv.get(`inbox:message:${messageId}`);
    if (existingMessage) {
      logger.warn("Duplicate message ID", { messageId });
      return NextResponse.json(
        { error: "Message already exists", messageId },
        { status: 409 }
      );
    }

    // Look up sender agent for BIP-322 verification and sent-index update
    const senderAgent = fromAddress !== "unknown" ? await lookupAgent(kv, fromAddress) : null;
    const sigResult = verifySenderSignature(senderSignatureInput, content, logger, senderAgent?.btcAddress);
    if (sigResult instanceof NextResponse) return sigResult;
    const { authenticated, senderBtcAddress } = sigResult;

    const now = new Date().toISOString();
    const message = {
      messageId,
      fromAddress,
      toBtcAddress,
      toStxAddress,
      content,
      paymentTxid: txidResult.paymentTxid || paymentTxid,
      paymentSatoshis: paymentSatoshis ?? INBOX_PRICE_SATS,
      sentAt: now,
      authenticated,
      recoveredViaTxid: true,
      ...(senderBtcAddress && { senderBtcAddress }),
      ...(senderSignatureInput && { senderSignature: senderSignatureInput }),
      ...(replyTo && { replyTo }),
    };

    // Store message, update indexes, and mark txid as redeemed (with TTL)
    await Promise.all([
      storeMessage(kv, message),
      updateAgentInbox(kv, toBtcAddress, messageId, now),
      kv.put(redeemedKey, messageId, { expirationTtl: REDEEMED_TXID_TTL_SECONDS }),
      ...(senderAgent
        ? [updateSentIndex(kv, senderAgent.btcAddress, messageId, now)]
        : []),
    ]);

    // Grant "Receiver" achievement on first inbox message received (best-effort)
    try {
      const hasReceiverTxid = await hasAchievement(kv, toBtcAddress, "receiver");
      if (!hasReceiverTxid) {
        await grantAchievement(kv, toBtcAddress, "receiver", { messageId });
        logger.info("Receiver achievement granted", {
          btcAddress: toBtcAddress,
          achievementName: "Receiver",
        });
      }
    } catch (error) {
      console.error("Failed to check receiver achievement during inbox store:", error);
    }

    // Grant x402-earner achievement to recipient on first x402 payment received (idempotent)
    await grantAchievement(kv, toBtcAddress, "x402-earner", { messageId, paymentTxid }).catch((err) =>
      logger.warn("grantAchievement failed (non-fatal)", { err, toBtcAddress })
    );

    logger.info("Message stored via txid recovery", {
      messageId,
      fromAddress,
      toBtcAddress,
      paymentTxid,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Message sent successfully (recovered via txid proof)",
        inbox: {
          messageId,
          fromAddress,
          toBtcAddress,
          sentAt: now,
          authenticated,
          recoveredViaTxid: true,
          ...(senderBtcAddress && { senderBtcAddress }),
        },
      },
      { status: 201 }
    );
  }

  // x402 payment path: paymentSigHeader is present (both !paymentSigHeader branches returned above)
  if (!paymentSigHeader) {
    // Unreachable -- satisfies TypeScript narrowing
    return NextResponse.json({ error: "Missing payment signature" }, { status: 400 });
  }

  // Parse and validate payment signature (base64-encoded JSON per x402 v2, with plain JSON fallback)
  // Uses HttpPaymentPayloadSchema.safeParse to catch structurally invalid payloads before
  // downstream code touches optional fields like `accepted.asset` (prevents #629 TypeError).
  let paymentPayload: PaymentPayloadV2;
  let decodedPaymentJson: unknown;
  let usedFallback = false;
  try {
    const decoded = atob(paymentSigHeader);
    decodedPaymentJson = JSON.parse(decoded);
  } catch {
    try {
      decodedPaymentJson = JSON.parse(paymentSigHeader);
      usedFallback = true;
    } catch {
      logger.error("Invalid payment signature format");
      return NextResponse.json(
        {
          error:
            "Invalid payment-signature header (expected base64-encoded JSON)",
        },
        { status: 400 }
      );
    }
  }

  const parsedPaymentPayload = HttpPaymentPayloadSchema.safeParse(decodedPaymentJson);
  if (!parsedPaymentPayload.success) {
    logger.warn("Invalid payment-signature payload structure", {
      issues: parsedPaymentPayload.error.issues,
    });
    return NextResponse.json(
      {
        error: "invalid_payment_payload",
        issues: parsedPaymentPayload.error.issues,
      },
      { status: 400 }
    );
  }
  paymentPayload = parsedPaymentPayload.data as PaymentPayloadV2;

  if (usedFallback) {
    logPaymentEvent(logger, "warn", "payment.fallback_used", repoVersion, {
      route: request.nextUrl.pathname,
      status: "compat",
      action: "plain_json_payment_signature_header",
      compatShimUsed: true,
    });
  }

  // Verify x402 payment
  logger.info("Verifying x402 payment", {
    network,
    recipientStx: agent.stxAddress,
  });

  const paymentResult = await verifyInboxPayment(
    paymentPayload,
    agent.stxAddress,
    network,
    relayUrl,
    logger,
    kv,
    env.X402_RELAY,
    { route: request.nextUrl.pathname, repoVersion, env: env as unknown as Record<string, unknown> }
  );

  if (!paymentResult.success) {
    const isExpectedNonceFailure =
      paymentResult.errorCode === "SENDER_NONCE_DUPLICATE" ||
      paymentResult.errorCode === "SENDER_NONCE_STALE" ||
      paymentResult.errorCode === "SENDER_NONCE_GAP";
    if (isExpectedNonceFailure) {
      logger.warn("Payment rejected: sender nonce state (expected)", {
        errorCode: paymentResult.errorCode,
        retryAfterSeconds: paymentResult.retryAfterSeconds,
      });
    } else {
      logger.error("Payment verification failed", {
        error: paymentResult.error,
        errorCode: paymentResult.errorCode,
        retryAfterSeconds: paymentResult.retryAfterSeconds,
      });
    }

    const errorCode = paymentResult.errorCode;
    const retryAfterSeconds = paymentResult.retryAfterSeconds ?? 5;
    const relayDiag = {
      ...(paymentResult.relayCode && { relayCode: paymentResult.relayCode }),
      ...(paymentResult.relayDetail && { relayDetail: paymentResult.relayDetail }),
    };

    // NONCE_CONFLICT — retryable; same tx hex is idempotent within 5 min.
    if (errorCode === "NONCE_CONFLICT") {
      const nonceAction = NONCE_ACTION_MAP[errorCode];
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: request.nextUrl.pathname,
        paymentId: paymentResult.paymentId ?? null,
        status: errorCode,
        action: nonceAction,
        terminalReason: paymentResult.terminalReason ?? null,
        additionalContext: {
          relayCode: paymentResult.relayCode ?? null,
          retryAfter: retryAfterSeconds,
          recipientBtcAddress: agent.btcAddress,
          requestId: rayId,
        },
      });
      return NextResponse.json(
        {
          error: `Nonce conflict: another transaction from your wallet is pending. Retry after ${retryAfterSeconds}s.`,
          code: errorCode,
          retryable: true,
          retryAfter: retryAfterSeconds,
          nextSteps: "Retry the payment — the relay had a transient nonce collision",
          ...relayDiag,
          action: nonceAction,
          ...(paymentResult.payerStxAddress && {
            sender: { stxAddress: paymentResult.payerStxAddress },
          }),
          diagnostics: {
            ...(paymentResult.relayCode && { relayCode: paymentResult.relayCode }),
            ...(paymentResult.paymentId && { paymentId: paymentResult.paymentId }),
            requestId: rayId,
          },
          docs: "https://github.com/aibtcdev/x402-sponsor-relay/tree/main/docs",
        },
        {
          status: 409,
          headers: { "Retry-After": String(retryAfterSeconds) },
        }
      );
    }

    // BROADCAST_FAILED — relay could not submit tx to the network; funds safe, retry with new payment.
    // Distinct from SETTLEMENT_FAILED where the tx was broadcast but rejected on-chain.
    if (errorCode === "BROADCAST_FAILED") {
      return NextResponse.json(
        {
          error: "Transaction broadcast failed. The relay could not submit your transaction to the network.",
          code: errorCode,
          retryable: false,
          nextSteps: "The sBTC transfer was not sent — your funds are safe. Retry with a new payment.",
          ...relayDiag,
        },
        { status: 502 }
      );
    }

    // INVALID_TRANSACTION_FORMAT — payload contains invalid data (e.g. raw hex instead of serialized Stacks tx).
    if (errorCode === "INVALID_TRANSACTION_FORMAT") {
      return NextResponse.json(
        {
          error: "Invalid payment transaction format",
          code: errorCode,
          retryable: false,
          details: "Could not deserialize Stacks transaction — ensure you are sending a serialized transaction (via serializeTransaction()), not a raw hex string",
          hint: "The payment-signature header should contain a base64-encoded JSON object with a 'transaction' field containing the hex-serialized Stacks transaction",
          documentation: "https://aibtc.com/docs/messaging.txt",
        },
        { status: 400 }
      );
    }

    // SETTLEMENT_FAILED — tx was broadcast but aborted on-chain (e.g. post-condition failure); not retryable as-is.
    if (errorCode === "SETTLEMENT_FAILED") {
      return NextResponse.json(
        {
          error: "Transaction was broadcast but rejected on-chain by contract post-conditions. This is not retryable with the same payment.",
          code: errorCode,
          retryable: false,
          nextSteps: "Check that the transfer amount, asset, and recipient match requirements. Submit a new payment.",
          ...relayDiag,
        },
        { status: 422 }
      );
    }

    if (errorCode === "PAYMENT_NOT_FOUND") {
      return NextResponse.json(
        {
          error:
            "The relay no longer recognizes this payment identity. Inbox delivery was not completed.",
          code: errorCode,
          retryable: false,
          nextSteps:
            "Do not assume delivery. Stop polling the old payment identity and restart the higher-level payment flow deliberately.",
          ...(paymentResult.terminalReason && { terminalReason: paymentResult.terminalReason }),
          ...(paymentResult.checkStatusUrl && { checkStatusUrl: paymentResult.checkStatusUrl }),
          ...relayDiag,
        },
        { status: 409 }
      );
    }

    if (errorCode === "MISSING_CANONICAL_IDENTITY") {
      return NextResponse.json(buildMissingCanonicalIdentityBody(paymentResult), { status: 502 });
    }

    // RELAY_ERROR — relay 5xx, unexpected failure, or circuit breaker open.
    // Use the retryAfterSeconds from the verification result (circuit breaker returns 300s,
    // ordinary relay errors default to 10s).
    if (errorCode === "RELAY_ERROR") {
      const relayRetryAfter = paymentResult.retryAfterSeconds ?? 10;
      const isCircuitOpen = relayRetryAfter >= RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS;
      return NextResponse.json(
        {
          error: isCircuitOpen
            ? "Relay is temporarily unavailable due to repeated failures. Please retry later."
            : "Relay service error. Try again in a moment.",
          code: errorCode,
          retryable: true,
          retryAfter: relayRetryAfter,
          nextSteps: isCircuitOpen
            ? `Relay circuit breaker is open — retry in ${relayRetryAfter} seconds`
            : "Relay was slow — retry the request",
          ...relayDiag,
        },
        {
          status: isCircuitOpen ? 503 : 502,
          headers: { "Retry-After": String(relayRetryAfter) },
        }
      );
    }

    // INSUFFICIENT_FUNDS — not enough sBTC.
    if (errorCode === "INSUFFICIENT_FUNDS") {
      return NextResponse.json(
        {
          ...paymentRequiredBody,
          error: `Insufficient sBTC balance. You need at least ${INBOX_PRICE_SATS} sats to send a message.`,
          code: errorCode,
          retryable: false,
          nextSteps: "Fund your wallet with sufficient sBTC before retrying",
        },
        {
          status: 402,
          headers: { [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader },
        }
      );
    }

    // SETTLEMENT_TIMEOUT — safety net: should not occur on the RPC path after the relay-rpc fix
    // (poll exhaustion after relay accepted now returns pending success). May still occur on the
    // HTTP fallback path. Log as unexpected if seen frequently.
    if (errorCode === "SETTLEMENT_TIMEOUT") {
      logger.warn("SETTLEMENT_TIMEOUT reached — unexpected on RPC path, check relay-rpc.ts", {
        errorCode,
        ...relayDiag,
      });
      return NextResponse.json(
        {
          error: "Payment broadcast but settlement confirmation timed out.",
          code: errorCode,
          retryable: true,
          retryAfter: 60,
          nextSteps: "Your transaction was submitted but confirmation timed out. Resubmit with the confirmed paymentTxid once it appears on-chain.",
          ...relayDiag,
        },
        {
          status: 409,
          headers: { "Retry-After": "60" },
        }
      );
    }

    // SENDER_NONCE_* — RPC path nonce rejections. All return HTTP 409 with retry guidance.
    const nonceError = errorCode ? SENDER_NONCE_ERRORS[errorCode] : undefined;
    if (nonceError) {
      const nonceAction = errorCode ? NONCE_ACTION_MAP[errorCode] : undefined;
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: request.nextUrl.pathname,
        paymentId: paymentResult.paymentId ?? null,
        status: errorCode,
        action: nonceAction,
        terminalReason: paymentResult.terminalReason ?? null,
        additionalContext: {
          relayCode: paymentResult.relayCode ?? null,
          retryAfter: nonceError.retryAfter,
          recipientBtcAddress: agent.btcAddress,
          requestId: rayId,
        },
      });
      return NextResponse.json(
        {
          error: nonceError.error,
          code: errorCode,
          retryable: true,
          retryAfter: nonceError.retryAfter,
          nextSteps: nonceError.nextSteps,
          ...relayDiag,
          action: nonceAction,
          ...(paymentResult.payerStxAddress && {
            sender: { stxAddress: paymentResult.payerStxAddress },
          }),
          diagnostics: {
            ...(paymentResult.relayCode && { relayCode: paymentResult.relayCode }),
            ...(paymentResult.paymentId && { paymentId: paymentResult.paymentId }),
            requestId: rayId,
          },
          docs: "https://github.com/aibtcdev/x402-sponsor-relay/tree/main/docs",
        },
        {
          status: 409,
          headers: { "Retry-After": String(nonceError.retryAfter) },
        }
      );
    }

    // Default / PAYMENT_REJECTED — return 402 with payment requirements.
    // Sanitize: don't leak raw relay internals to clients.
    return NextResponse.json(
      {
        ...paymentRequiredBody,
        error: "Payment could not be processed. Please try again.",
        code: errorCode ?? "PAYMENT_REJECTED",
        retryable: false,
        nextSteps: "Check your payment payload and try again. If the problem persists, verify your sBTC balance.",
      },
      {
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader,
        },
      }
    );
  }

  const fromAddress = paymentResult.payerStxAddress || "unknown";
  const messageId = `msg_${Date.now()}_${crypto.randomUUID()}`;

  // Guard against (extremely unlikely) server-generated ID collision
  const existingMessage = await kv.get(`inbox:message:${messageId}`);
  if (existingMessage) {
    logger.warn("Duplicate message ID", { messageId });
    return NextResponse.json(
      {
        error: "Message already exists",
        messageId,
      },
      { status: 409 }
    );
  }

  // Look up sender agent for BIP-322 verification and sent-index update
  const senderAgent = fromAddress !== "unknown" ? await lookupAgent(kv, fromAddress) : null;
  const sigResult = verifySenderSignature(senderSignatureInput, content, logger, senderAgent?.btcAddress);
  if (sigResult instanceof NextResponse) return sigResult;
  const { authenticated, senderBtcAddress } = sigResult;

  const now = new Date().toISOString();
  const message = {
    messageId,
    fromAddress,
    toBtcAddress,
    toStxAddress,
    content,
    paymentTxid: paymentResult.paymentTxid || paymentTxid || undefined,
    paymentSatoshis: paymentSatoshis ?? INBOX_PRICE_SATS,
    sentAt: now,
    authenticated,
    ...(senderBtcAddress && { senderBtcAddress }),
    ...(senderSignatureInput && { senderSignature: senderSignatureInput }),
    ...(replyTo && { replyTo }),
    paymentStatus: paymentResult.paymentStatus ?? "confirmed",
    ...(paymentResult.paymentId && { paymentId: paymentResult.paymentId }),
    ...(paymentResult.receiptId && { receiptId: paymentResult.receiptId }),
  };

  const responseHeaders: Record<string, string> = {};

  if (paymentResult.paymentStatus === "pending") {
    if (!paymentResult.paymentId) {
      logPaymentEvent(logger, "error", "payment.fallback_used", repoVersion, {
        route: request.nextUrl.pathname,
        paymentId: null,
        status: "pending",
        action: "reject_pending_without_canonical_identity",
        additionalContext: {
          messageId,
          fromAddress,
          toBtcAddress,
          receiptId: paymentResult.receiptId ?? null,
          checkStatusUrl: paymentResult.checkStatusUrl ?? null,
        },
      });
      logger.error("Pending payment result missing canonical paymentId; refusing delivery", {
        messageId,
        fromAddress,
        toBtcAddress,
      });
      return NextResponse.json(buildMissingCanonicalIdentityBody(paymentResult), { status: 502 });
    } else {
      const checkStatusUrl =
        paymentResult.checkStatusUrl ?? `/api/payment-status/${paymentResult.paymentId}`;

      await storeStagedInboxPayment(kv, {
        paymentId: paymentResult.paymentId,
        createdAt: now,
        ...(senderAgent?.btcAddress && { senderSentIndexBtcAddress: senderAgent.btcAddress }),
        message,
      });

      await enqueueInboxReconciliation(
        env.INBOX_RECONCILIATION_QUEUE,
        {
          paymentId: paymentResult.paymentId,
          stagedAt: now,
          attempt: 0,
          source: "inbox_post",
        },
        logger,
        repoVersion,
        request.nextUrl.pathname,
        {
          messageId,
          workerStage: "http_inbox_post",
        }
      );

      responseHeaders["X-Payment-Status"] = "pending";
      responseHeaders["X-Payment-Id"] = paymentResult.paymentId;
      responseHeaders["X-Payment-Check-Url"] = checkStatusUrl;

      logPaymentEvent(logger, "info", "payment.delivery_staged", repoVersion, {
        route: request.nextUrl.pathname,
        paymentId: paymentResult.paymentId,
        status: "pending",
        action: "stage_delivery",
        checkStatusUrl,
        additionalContext: {
          messageId,
          fromAddress,
          toBtcAddress,
          senderBtcAddress: senderAgent?.btcAddress ?? null,
          worker_stage: "http_inbox_post",
          trigger: "inbox_post",
        },
      });

      return NextResponse.json(
        {
          success: true,
          message: "Payment accepted. Inbox delivery is staged until the relay reports confirmed.",
          inbox: {
            fromAddress,
            toBtcAddress,
            sentAt: now,
            authenticated,
            ...(senderBtcAddress && { senderBtcAddress }),
            paymentStatus: "pending",
            paymentId: paymentResult.paymentId,
          },
          checkStatusUrl,
        },
        {
          status: 202,
          headers: responseHeaders,
        }
      );
    }
  }

  await Promise.all([
    storeMessage(kv, message),
    updateAgentInbox(kv, toBtcAddress, messageId, now),
    ...(senderAgent
      ? [updateSentIndex(kv, senderAgent.btcAddress, messageId, now)]
      : []),
  ]);

  try {
    const hasReceiverX402 = await hasAchievement(kv, toBtcAddress, "receiver");
    if (!hasReceiverX402) {
      await grantAchievement(kv, toBtcAddress, "receiver", { messageId });
      logger.info("Receiver achievement granted", {
        btcAddress: toBtcAddress,
        achievementName: "Receiver",
      });
    }
  } catch (error) {
    console.error("Failed to check receiver achievement during inbox store:", error);
  }

  await grantAchievement(kv, toBtcAddress, "x402-earner", { messageId, paymentTxid: message.paymentTxid }).catch((err) =>
    logger.warn("grantAchievement failed (non-fatal)", { err, toBtcAddress })
  );

  const deliveredPaymentStatus = message.paymentStatus ?? "confirmed";
  const deliveredCheckStatusUrl = paymentResult.paymentId
    ? paymentResult.checkStatusUrl ?? `/api/payment-status/${paymentResult.paymentId}`
    : undefined;

  logPaymentEvent(logger, "info", "payment.delivery_confirmed", repoVersion, {
    route: request.nextUrl.pathname,
    paymentId: paymentResult.paymentId ?? null,
    status: deliveredPaymentStatus,
    action:
      deliveredPaymentStatus === "pending"
        ? "deliver_immediately_pending_fallback"
        : "deliver_immediately",
    checkStatusUrl: deliveredCheckStatusUrl,
    additionalContext: {
      messageId,
      fromAddress,
      toBtcAddress,
      senderBtcAddress: senderAgent?.btcAddress ?? null,
      paymentTxid: message.paymentTxid ?? null,
    },
  });

  await invalidateAgentListCache(kv);

  if (message.paymentTxid) {
    const paymentResponseData = {
      success: true,
      payer: fromAddress,
      transaction: message.paymentTxid,
      network: networkCAIP2,
    };
    responseHeaders[X402_HEADERS.PAYMENT_RESPONSE] = btoa(JSON.stringify(paymentResponseData));
  }
  responseHeaders["X-Payment-Status"] = deliveredPaymentStatus;
  if (paymentResult.paymentId) {
    responseHeaders["X-Payment-Id"] = paymentResult.paymentId;
    responseHeaders["X-Payment-Check-Url"] =
      deliveredCheckStatusUrl ?? `/api/payment-status/${paymentResult.paymentId}`;
  }

  return NextResponse.json(
    {
      success: true,
      message: "Message sent successfully",
      inbox: {
        messageId,
        fromAddress,
        toBtcAddress,
        sentAt: now,
        authenticated,
        ...(senderBtcAddress && { senderBtcAddress }),
        paymentStatus: deliveredPaymentStatus,
        ...(paymentResult.paymentId && { paymentId: paymentResult.paymentId }),
        ...(paymentResult.receiptId && { receiptId: paymentResult.receiptId }),
      },
    },
    {
      status: 201,
      headers: responseHeaders,
    }
  );

  } catch (error) {
    logger.error("Unhandled inbox POST error", { error: String(error) });
    return NextResponse.json(
      { error: "Internal server error processing inbox message" },
      { status: 500 }
    );
  }
}
