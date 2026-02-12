import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import type { AgentRecord } from "@/lib/types";
import {
  validateOutboxReply,
  getMessage,
  getReply,
  storeReply,
  updateMessage,
  buildReplyMessage,
  listInboxMessages,
} from "@/lib/inbox";
import {
  hasAchievement,
  grantAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import { createHash } from "crypto";

/**
 * Look up an agent by BTC or STX address.
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

  logger.info("Outbox reply submission", { address });

  // Look up agent
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    logger.warn("Agent not found", { address });
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
      },
      { status: 404 }
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

  // Validate reply body
  const validation = validateOutboxReply(body);
  if (validation.errors) {
    logger.warn("Validation failed", { errors: validation.errors });
    return NextResponse.json(
      { error: validation.errors.join(", ") },
      { status: 400 }
    );
  }

  const { messageId, reply, signature } = validation.data;

  // Fetch original message
  const message = await getMessage(kv, messageId);

  if (!message) {
    logger.warn("Message not found", { messageId });
    return NextResponse.json(
      {
        error: "Message not found",
        messageId,
      },
      { status: 404 }
    );
  }

  // Verify signature with reply message format
  const messageToVerify = buildReplyMessage(messageId, reply);

  let btcResult;
  try {
    btcResult = verifyBitcoinSignature(signature, messageToVerify);
  } catch (e) {
    logger.error("Invalid signature", { error: (e as Error).message });
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  if (!btcResult.valid) {
    logger.warn("Signature verification failed");
    return NextResponse.json(
      {
        error: "Bitcoin signature verification failed",
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  // Verify signer is recipient (message.toBtcAddress)
  if (btcResult.address !== message.toBtcAddress) {
    logger.warn("Signer is not recipient", {
      expected: message.toBtcAddress,
      actual: btcResult.address,
    });
    return NextResponse.json(
      {
        error: "Signature verification failed: signer is not the recipient",
        expectedSigner: message.toBtcAddress,
        actualSigner: btcResult.address,
      },
      { status: 403 }
    );
  }

  // Check if reply already exists
  const existingReply = await getReply(kv, messageId);

  if (existingReply) {
    logger.warn("Reply already exists", { messageId });
    return NextResponse.json(
      {
        error: "Reply already exists for this message",
        messageId,
        existingReply: {
          repliedAt: existingReply.repliedAt,
          reply: existingReply.reply,
        },
      },
      { status: 409 }
    );
  }

  // Store reply
  const now = new Date().toISOString();
  const outboxReply = {
    messageId,
    fromBtcAddress: message.toBtcAddress,
    toBtcAddress: message.fromBtcAddress,
    reply,
    signature,
    repliedAt: now,
  };

  await storeReply(kv, outboxReply);

  // Update message with repliedAt timestamp
  await updateMessage(kv, messageId, { repliedAt: now });

  // Grant "Communicator" achievement if not already earned
  const hasCommunicator = await hasAchievement(
    kv,
    btcResult.address,
    "communicator"
  );

  let newAchievement:
    | { id: string; name: string; new: true }
    | undefined = undefined;

  if (!hasCommunicator) {
    await grantAchievement(kv, btcResult.address, "communicator", {
      messageId,
    });

    const definition = getAchievementDefinition("communicator");
    newAchievement = {
      id: "communicator",
      name: definition?.name ?? "Communicator",
      new: true,
    };

    logger.info("Communicator achievement granted", {
      btcAddress: btcResult.address,
    });
  }

  // Generate reputationPayload (ERC-8004 feedbackHash)
  const feedbackHash = createHash("sha256")
    .update(`${messageId}${reply}${signature}`)
    .digest("hex");

  const reputationPayload = {
    feedbackHash,
    tag1: "x402-inbox",
    tag2: "reply",
  };

  logger.info("Reply stored", {
    messageId,
    fromBtcAddress: outboxReply.fromBtcAddress,
    toBtcAddress: outboxReply.toBtcAddress,
  });

  return NextResponse.json(
    {
      success: true,
      message: "Reply sent successfully",
      reply: {
        messageId,
        fromBtcAddress: outboxReply.fromBtcAddress,
        toBtcAddress: outboxReply.toBtcAddress,
        repliedAt: now,
      },
      reputationPayload,
      ...(newAchievement && { achievement: newAchievement }),
    },
    { status: 201 }
  );
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
        endpoint: "/api/outbox/[address]",
        description: "Replies sent by this agent to incoming inbox messages.",
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

  // Fetch all messages in agent's inbox
  const messages = await listInboxMessages(kv, agent.btcAddress, 100, 0);

  // Filter for messages with replies
  const repliedMessages = messages.filter((msg) => msg.repliedAt);

  // Fetch all replies in parallel
  const replies = await Promise.all(
    repliedMessages.map((msg) => getReply(kv, msg.messageId))
  );

  // Filter out nulls
  const validReplies = replies.filter((r) => r !== null);

  // If no replies, return self-documenting response
  if (validReplies.length === 0) {
    return NextResponse.json({
      endpoint: "/api/outbox/[address]",
      description: "Replies sent by this agent to incoming inbox messages.",
      agent: {
        btcAddress: agent.btcAddress,
        displayName: agent.displayName,
      },
      outbox: {
        replies: [],
        totalCount: 0,
      },
      howToReply: {
        endpoint: `POST /api/outbox/${address}`,
        requirement: "Sign reply with Bitcoin key to prove ownership",
        messageFormat: 'Inbox Reply | {messageId} | {reply text}',
        documentation: "https://aibtc.com/llms-full.txt",
      },
    });
  }

  return NextResponse.json({
    agent: {
      btcAddress: agent.btcAddress,
      displayName: agent.displayName,
    },
    outbox: {
      replies: validReplies,
      totalCount: validReplies.length,
    },
  });
}
