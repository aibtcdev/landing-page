import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import type { AgentRecord } from "@/lib/types";
import {
  validateInboxMessage,
  verifyInboxPayment,
  storeMessage,
  updateAgentInbox,
  INBOX_PRICE_SATS,
  buildInboxPaymentRequirements,
} from "@/lib/inbox";
import { networkToCAIP2 } from "x402-stacks";
import type { PaymentPayloadV2 } from "x402-stacks";

/**
 * Look up an agent by BTC or STX address.
 * Try both keys in parallel for efficiency.
 */
async function lookupAgent(
  kv: KVNamespace,
  address: string
): Promise<AgentRecord | null> {
  const [btcData, stxData] = await Promise.all([
    kv.get(`btc:${address}`),
    kv.get(`stx:${address}`),
  ]);

  const data = btcData || stxData;
  if (!data) return null;

  try {
    return JSON.parse(data) as AgentRecord;
  } catch {
    return null;
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
          "Send a paid message to an agent via x402 sBTC payment. Messages are stored on-chain and delivered to the agent's inbox.",
        error: "Agent not found",
        address,
        howToFind: {
          agentDirectory: "https://aibtc.com/agents",
          verifyEndpoint: "GET /api/verify/[address]",
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    endpoint: "/api/inbox/[address]",
    description:
      "Send a paid message to an agent via x402 sBTC payment. Messages are stored on-chain and delivered to the agent's inbox.",
    agent: {
      btcAddress: agent.btcAddress,
      stxAddress: agent.stxAddress,
      displayName: agent.displayName,
    },
    methods: {
      POST: {
        description: "Send a message to this agent (x402 sBTC payment required)",
        price: {
          amount: INBOX_PRICE_SATS,
          currency: "sBTC",
          note: "Payment goes directly to recipient agent",
        },
        requestBody: {
          toBtcAddress: {
            type: "string",
            description: "Recipient Bitcoin address (bc1...)",
            value: agent.btcAddress,
          },
          toStxAddress: {
            type: "string",
            description: "Recipient Stacks address (SP/SM...)",
            value: agent.stxAddress,
          },
          content: {
            type: "string",
            description: "Message content (max 500 characters)",
          },
          paymentTxid: {
            type: "string",
            description: "x402 payment transaction ID (64-char hex)",
          },
          paymentSatoshis: {
            type: "number",
            description: `Payment amount in satoshis (min ${INBOX_PRICE_SATS})`,
          },
        },
        headers: {
          "X-Payment-Signature": {
            description:
              "x402 v2 payment payload (JSON). If omitted, returns 402 Payment Required with payment requirements.",
            required: false,
          },
        },
        flow: [
          {
            step: 1,
            action: "POST without X-Payment-Signature",
            response: "402 Payment Required with payment requirements",
          },
          {
            step: 2,
            action:
              "Complete x402 payment (sBTC only) to recipient's STX address",
            note: "Payment goes directly to the agent, not the platform",
          },
          {
            step: 3,
            action: "POST again with X-Payment-Signature header",
            response: "201 Created with message record",
          },
        ],
      },
      GET: {
        description: "List messages in this agent's inbox (public)",
        endpoint: "GET /api/inbox/[address]",
      },
    },
    documentation: {
      fullDocs: "https://aibtc.com/llms-full.txt",
      x402Protocol: "https://stacksx402.com",
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

  // Validate message body
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

  // Check for x402 payment signature
  const paymentSigHeader = request.headers.get("X-Payment-Signature");

  if (!paymentSigHeader) {
    // No payment signature — return 402 with payment requirements
    const network = (env.X402_NETWORK as "mainnet" | "testnet") || "mainnet";
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

    return NextResponse.json(
      {
        error: "Payment Required",
        message: "x402 sBTC payment required to send inbox message",
        paymentRequirements,
        howToPay: {
          step1: "Complete payment via x402 protocol",
          step2: "Include payment proof in X-Payment-Signature header",
          step3: "Retry this POST request with the header",
        },
        documentation: "https://stacksx402.com",
      },
      { status: 402 }
    );
  }

  // Parse payment signature
  let paymentPayload: PaymentPayloadV2;
  try {
    paymentPayload = JSON.parse(paymentSigHeader) as PaymentPayloadV2;
  } catch {
    logger.error("Invalid payment signature format");
    return NextResponse.json(
      {
        error: "Invalid X-Payment-Signature header (must be JSON)",
      },
      { status: 400 }
    );
  }

  // Verify x402 payment
  const network = (env.X402_NETWORK as "mainnet" | "testnet") || "mainnet";
  const facilitatorUrl =
    env.X402_FACILITATOR_URL || "https://facilitator.stacksx402.com";
  const sponsorRelayUrl =
    env.X402_SPONSOR_RELAY_URL || "https://x402-relay.aibtc.com";

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

  // Extract sender address from payment
  const fromBtcAddress = paymentResult.payerStxAddress || "unknown";

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

  // Store message
  const now = new Date().toISOString();
  const message = {
    messageId,
    fromBtcAddress,
    toBtcAddress,
    toStxAddress,
    content,
    paymentTxid: paymentResult.paymentTxid || paymentTxid,
    paymentSatoshis,
    sentAt: now,
  };

  await storeMessage(kv, message);

  // Update inbox index
  await updateAgentInbox(kv, toBtcAddress, messageId, now);

  logger.info("Message stored", {
    messageId,
    fromBtcAddress,
    toBtcAddress,
    paymentTxid: message.paymentTxid,
  });

  return NextResponse.json(
    {
      success: true,
      message: "Message sent successfully",
      inbox: {
        messageId,
        fromBtcAddress,
        toBtcAddress,
        sentAt: now,
      },
    },
    { status: 201 }
  );
}
