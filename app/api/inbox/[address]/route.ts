import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateInboxMessage,
  verifyInboxPayment,
  storeMessage,
  updateAgentInbox,
  listInboxMessages,
  INBOX_PRICE_SATS,
  buildInboxPaymentRequirements,
} from "@/lib/inbox";
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

  // Parse query params for pagination
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");

  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100)
    : 20;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;

  // Single call returns index + messages + replies (eliminates redundant KV read)
  const { index: inboxIndex, messages, replies } = await listInboxMessages(
    kv,
    agent.btcAddress,
    limit,
    offset,
    { includeReplies: true }
  );

  const totalCount = inboxIndex?.messageIds.length || 0;
  const unreadCount = inboxIndex?.unreadCount || 0;

  // Serialize reply map as object for JSON response
  const repliesObject: Record<string, unknown> = {};
  for (const [messageId, reply] of replies) {
    repliesObject[messageId] = reply;
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
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < totalCount,
        nextOffset: offset + limit < totalCount ? offset + limit : null,
      },
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
    env.X402_FACILITATOR_URL || "https://facilitator.stacksx402.com";
  const sponsorRelayUrl =
    env.X402_SPONSOR_RELAY_URL || "https://x402-relay.aibtc.com";

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

  if (!paymentSigHeader) {
    // No payment signature — return 402 with x402 v2 payment requirements
    const networkCAIP2 = networkToCAIP2(network);
    const paymentRequirements = buildInboxPaymentRequirements(
      agent.stxAddress,
      network,
      networkCAIP2
    );

    logger.info("Returning 402 Payment Required", {
      recipientStx: agent.stxAddress,
      minAmount: INBOX_PRICE_SATS,
    });

    // Build v2-compliant PaymentRequiredV2 response
    const resourceUrl = `${request.nextUrl.protocol}//${request.headers.get("host")}${request.nextUrl.pathname}`;
    const paymentRequiredBody = {
      x402Version: 2 as const,
      resource: {
        url: resourceUrl,
        description: `Send message to ${agent.displayName} (${INBOX_PRICE_SATS} sats sBTC)`,
        mimeType: "application/json",
      },
      accepts: [paymentRequirements],
    };

    // Set payment-required header (base64-encoded JSON per x402 v2 spec)
    const paymentRequiredHeader = btoa(JSON.stringify(paymentRequiredBody));

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
        error: paymentResult.error || "Payment verification failed",
        errorCode: paymentResult.errorCode,
      },
      { status: 402 }
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
  };

  // Store message and update inbox index in parallel (independent writes)
  await Promise.all([
    storeMessage(kv, message),
    updateAgentInbox(kv, toBtcAddress, messageId, now),
  ]);

  logger.info("Message stored", {
    messageId,
    fromAddress,
    toBtcAddress,
    paymentTxid: message.paymentTxid,
  });

  // Build payment-response header (base64-encoded per x402 v2 spec)
  const networkCAIP2 = networkToCAIP2(network);
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
