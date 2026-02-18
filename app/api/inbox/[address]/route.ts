import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateInboxMessage,
  verifyInboxPayment,
  storeMessage,
  updateAgentInbox,
  updateSentIndex,
  listInboxMessages,
  listSentMessages,
  getSentIndex,
  INBOX_PRICE_SATS,
  buildInboxPaymentRequirements,
  buildSenderAuthMessage,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_SPONSOR_RELAY_URL,
} from "@/lib/inbox";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent as lookupSenderAgent } from "@/lib/agent-lookup";
import { networkToCAIP2, X402_HEADERS } from "x402-stacks";
import type { PaymentPayloadV2 } from "x402-stacks";

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

  // Parse query params for pagination, view, and includes
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const viewParam = url.searchParams.get("view") || "all";
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

  const view = viewParam as "sent" | "received" | "all";

  // Fetch data based on view param
  const includeReceived = view === "received" || view === "all";
  const includeSent = view === "sent" || view === "all";

  const [receivedResult, sentResult] = await Promise.all([
    includeReceived
      ? listInboxMessages(kv, agent.btcAddress, view === "all" ? 100 : limit, view === "all" ? 0 : offset, { includeReplies: true })
      : Promise.resolve(null),
    includeSent
      ? listSentMessages(kv, agent.btcAddress, view === "all" ? 100 : limit, view === "all" ? 0 : offset, { includeReplies: true })
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

  // Apply pagination for "all" view (others already paginated)
  if (view === "all") {
    combined = combined.slice(offset, offset + limit);
  }

  // Merge reply maps
  const repliesObject: Record<string, unknown> = {};
  if (receivedResult) {
    for (const [messageId, reply] of receivedResult.replies) {
      repliesObject[messageId] = reply;
    }
  }
  if (sentResult) {
    for (const [messageId, reply] of sentResult.replies) {
      repliesObject[messageId] = reply;
    }
  }

  const receivedCount = receivedResult?.index?.messageIds.length ?? 0;
  const sentCount = sentResult?.index?.messageIds.length ?? 0;
  const unreadCount = receivedResult?.index?.unreadCount ?? 0;
  const totalCount =
    view === "all"
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

    // Sort by message count (descending), then by most recent interaction
    resolvedPartners.sort((a, b) => {
      if (b.messageCount !== a.messageCount) {
        return b.messageCount - a.messageCount;
      }
      return new Date(b.lastInteractionAt).getTime() - new Date(a.lastInteractionAt).getTime();
    });

    // Limit to top 10 partners
    partners = resolvedPartners.slice(0, 10);
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
          "POST with payment-signature header (base64 PaymentPayloadV2) → message delivered",
        ],
        documentation: "https://aibtc.com/llms-full.txt",
      },
      parameters: {
        view: "Filter messages: 'sent', 'received', or 'all' (default: 'all')",
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

  // Extract network config once (used by both 402 response and payment verification)
  const network = (env.X402_NETWORK as "mainnet" | "testnet") || "mainnet";
  const facilitatorUrl =
    env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
  const sponsorRelayUrl =
    env.X402_SPONSOR_RELAY_URL || DEFAULT_SPONSOR_RELAY_URL;

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
  } catch {
    logger.error("Malformed JSON body");
    return NextResponse.json(
      { error: "Malformed JSON body" },
      { status: 400 }
    );
  }

  // Check for x402 v2 payment signature (base64-encoded JSON in payment-signature header)
  const paymentSigHeader =
    request.headers.get(X402_HEADERS.PAYMENT_SIGNATURE) ||
    request.headers.get("X-Payment-Signature"); // backwards compat

  // Validate message body (paymentTxid/paymentSatoshis are optional for the initial 402 request)
  const validation = validateInboxMessage(body);
  if (validation.errors) {
    logger.warn("Validation failed", { errors: validation.errors });
    return NextResponse.json(
      { error: validation.errors.join(", ") },
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
  } = validation.data;

  // Verify recipient matches agent
  if (toBtcAddress !== agent.btcAddress || toStxAddress !== agent.stxAddress) {
    logger.warn("Recipient mismatch", {
      expectedBtc: agent.btcAddress,
      providedBtc: toBtcAddress,
      expectedStx: agent.stxAddress,
      providedStx: toStxAddress,
    });
    return NextResponse.json(
      {
        error: "Recipient address mismatch",
        hint: `This endpoint is for messages to ${agent.displayName} (${agent.btcAddress})`,
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
      description: `Send message to ${agent.displayName} (${INBOX_PRICE_SATS} sats sBTC)`,
      mimeType: "application/json",
    },
    accepts: [paymentRequirements],
  };
  const paymentRequiredHeader = btoa(JSON.stringify(paymentRequiredBody));

  if (!paymentSigHeader) {
    // No payment signature — return 402 with payment requirements
    logger.info("Returning 402 Payment Required", {
      recipientStx: agent.stxAddress,
      minAmount: INBOX_PRICE_SATS,
    });

    return NextResponse.json(paymentRequiredBody, {
      status: 402,
      headers: {
        [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader,
      },
    });
  }

  // Parse payment signature (base64-encoded JSON per x402 v2, with plain JSON fallback)
  let paymentPayload: PaymentPayloadV2;
  try {
    // Try base64 decode first (v2 standard)
    const decoded = atob(paymentSigHeader);
    paymentPayload = JSON.parse(decoded) as PaymentPayloadV2;
  } catch {
    // Fallback: try plain JSON (backwards compat)
    try {
      paymentPayload = JSON.parse(paymentSigHeader) as PaymentPayloadV2;
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

  // Verify x402 payment
  logger.info("Verifying x402 payment", {
    network,
    recipientStx: agent.stxAddress,
  });

  const paymentResult = await verifyInboxPayment(
    paymentPayload,
    agent.stxAddress,
    network,
    facilitatorUrl,
    sponsorRelayUrl,
    logger
  );

  if (!paymentResult.success) {
    logger.error("Payment verification failed", {
      error: paymentResult.error,
      errorCode: paymentResult.errorCode,
    });
    return NextResponse.json(
      {
        ...paymentRequiredBody,
        error: paymentResult.error || "Payment verification failed",
        errorCode: paymentResult.errorCode,
      },
      {
        status: 402,
        headers: {
          [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader,
        },
      }
    );
  }

  // Extract sender address from payment (payer's STX address from x402 settlement)
  const fromAddress = paymentResult.payerStxAddress || "unknown";

  // Generate message ID (use memo if present, otherwise generate)
  const messageId =
    paymentResult.messageId || `msg_${Date.now()}_${crypto.randomUUID()}`;

  // Check for duplicate message
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

  // Verify optional sender signature (BIP-137 over "Inbox Message | {content}")
  // Signature is opt-in — unsigned messages continue to work unchanged.
  let senderBtcAddress: string | undefined;
  let authenticated = false;

  if (senderSignatureInput) {
    try {
      const sigResult = verifyBitcoinSignature(
        senderSignatureInput,
        buildSenderAuthMessage(content)
      );
      if (sigResult.valid) {
        senderBtcAddress = sigResult.address;
        authenticated = true;
        logger.info("Sender signature verified", { senderBtcAddress });
      } else {
        logger.warn("Sender signature verification failed (invalid)");
        return NextResponse.json(
          { error: "Sender signature verification failed" },
          { status: 400 }
        );
      }
    } catch (err) {
      logger.warn("Sender signature verification threw error", {
        error: String(err),
      });
      return NextResponse.json(
        { error: "Sender signature verification failed: invalid format" },
        { status: 400 }
      );
    }
  }

  // Store message (fromAddress stores the payer's STX address from x402 settlement)
  const now = new Date().toISOString();
  const message = {
    messageId,
    fromAddress,
    toBtcAddress,
    toStxAddress,
    content,
    paymentTxid: paymentResult.paymentTxid || paymentTxid || "",
    paymentSatoshis: paymentSatoshis ?? INBOX_PRICE_SATS,
    sentAt: now,
    authenticated,
    ...(senderBtcAddress && { senderBtcAddress }),
    ...(senderSignatureInput && { senderSignature: senderSignatureInput }),
  };

  // Resolve sender's BTC address from their STX address (for sent index)
  const senderAgent =
    fromAddress !== "unknown"
      ? await lookupSenderAgent(kv, fromAddress)
      : null;

  // Store message, update recipient inbox, and update sender sent index in parallel
  await Promise.all([
    storeMessage(kv, message),
    updateAgentInbox(kv, toBtcAddress, messageId, now),
    ...(senderAgent
      ? [updateSentIndex(kv, senderAgent.btcAddress, messageId, now)]
      : []),
  ]);

  logger.info("Message stored", {
    messageId,
    fromAddress,
    toBtcAddress,
    senderBtcAddress: senderAgent?.btcAddress ?? null,
    paymentTxid: message.paymentTxid,
  });

  // Build payment-response header (base64-encoded per x402 v2 spec)
  const paymentResponseData = {
    success: true,
    payer: fromAddress,
    transaction: message.paymentTxid,
    network: networkCAIP2,
  };
  const paymentResponseHeader = btoa(JSON.stringify(paymentResponseData));

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
      },
    },
    {
      status: 201,
      headers: {
        [X402_HEADERS.PAYMENT_RESPONSE]: paymentResponseHeader,
      },
    }
  );
}
