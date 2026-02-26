import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateOutboxReply,
  getMessage,
  getReply,
  storeReply,
  updateMessage,
  buildReplyMessage,
  listInboxMessages,
  decrementUnreadCount,
} from "@/lib/inbox";
import {
  OUTBOX_RATE_LIMIT_UNREGISTERED_MAX,
  OUTBOX_RATE_LIMIT_UNREGISTERED_TTL_SECONDS,
  OUTBOX_RATE_LIMIT_REGISTERED_MAX,
  OUTBOX_RATE_LIMIT_REGISTERED_TTL_SECONDS,
} from "@/lib/inbox/constants";
import {
  hasAchievement,
  grantAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";

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

  // Look up agent first — rate limits are applied contextually below.
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    // Rate limit unregistered addresses to prevent repeated 404 attempts
    // from flooding the log and KV.
    const unregisteredRateLimitKey = `ratelimit:outbox-unregistered:${address}`;
    const unregisteredCountRaw = await kv.get(unregisteredRateLimitKey);
    const unregisteredCount = unregisteredCountRaw
      ? parseInt(unregisteredCountRaw, 10)
      : 0;

    if (unregisteredCount >= OUTBOX_RATE_LIMIT_UNREGISTERED_MAX) {
      logger.warn("Outbox rate limited (unregistered)", {
        address,
        count: unregisteredCount,
      });
      return NextResponse.json(
        {
          error:
            "Too many attempts from this address. This address is not registered as an AIBTC agent.",
          address,
          action:
            "Register at POST /api/register to use the outbox endpoint.",
          documentation: "https://aibtc.com/api/register",
          retryAfter: "1 hour",
        },
        {
          status: 429,
          headers: { "Retry-After": String(OUTBOX_RATE_LIMIT_UNREGISTERED_TTL_SECONDS) },
        }
      );
    }

    // Fixed-window counter: set TTL only on first attempt so the window
    // expires from the first request, not the latest one.
    // KV read-then-write is not atomic; concurrent under-counting is accepted.
    if (unregisteredCount === 0) {
      await kv.put(unregisteredRateLimitKey, "1", {
        expirationTtl: OUTBOX_RATE_LIMIT_UNREGISTERED_TTL_SECONDS,
      });
    } else {
      await kv.put(
        unregisteredRateLimitKey,
        String(unregisteredCount + 1)
      );
    }
    logger.warn("Agent not found", { address });
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        action:
          "Register at POST /api/register to use the outbox endpoint.",
        documentation: "https://aibtc.com/api/register",
      },
      { status: 404 }
    );
  }

  logger.info("Outbox reply submission", { address });

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
    btcResult = verifyBitcoinSignature(signature, messageToVerify, message.toBtcAddress);
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

  // Verify path address resolves to the same agent as the signer
  if (btcResult.address !== agent.btcAddress) {
    logger.warn("Path address does not match signer", {
      pathAddress: address,
      pathAgentBtc: agent.btcAddress,
      signerBtc: btcResult.address,
    });
    return NextResponse.json(
      {
        error:
          "Path address does not match signer. Use your own outbox endpoint.",
        expectedAddress: btcResult.address,
        providedAddress: address,
      },
      { status: 403 }
    );
  }

  // Rate limit registered callers by signer identity (not path address)
  // to prevent scripted flooding. Placed after signature verification so
  // we know the caller's real BTC address.
  const registeredRateLimitKey = `ratelimit:outbox:${btcResult.address}`;
  const registeredCountRaw = await kv.get(registeredRateLimitKey);
  const registeredCount = registeredCountRaw
    ? parseInt(registeredCountRaw, 10)
    : 0;

  if (registeredCount >= OUTBOX_RATE_LIMIT_REGISTERED_MAX) {
    logger.warn("Outbox rate limited (registered)", {
      callerAddress: btcResult.address,
      count: registeredCount,
    });
    return NextResponse.json(
      {
        error: "Too many outbox requests. Slow down.",
        address: btcResult.address,
        retryAfter: "1 minute",
      },
      {
        status: 429,
        headers: { "Retry-After": String(OUTBOX_RATE_LIMIT_REGISTERED_TTL_SECONDS) },
      }
    );
  }

  // Fixed-window counter: set TTL only on first attempt so the window
  // expires from the first request, not the latest one.
  if (registeredCount === 0) {
    await kv.put(registeredRateLimitKey, "1", {
      expirationTtl: OUTBOX_RATE_LIMIT_REGISTERED_TTL_SECONDS,
    });
  } else {
    await kv.put(
      registeredRateLimitKey,
      String(registeredCount + 1)
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
    fromAddress: message.toBtcAddress,
    toBtcAddress: message.fromAddress,
    reply,
    signature,
    repliedAt: now,
  };

  // Check if message is already read (to know if we need to decrement unread)
  const wasUnread = !message.readAt;

  // Store reply, update message (also mark as read), and check achievement in parallel
  const [, , hasCommunicator] = await Promise.all([
    storeReply(kv, outboxReply),
    updateMessage(kv, messageId, {
      repliedAt: now,
      ...(!message.readAt && { readAt: now }),
    }),
    hasAchievement(kv, btcResult.address, "communicator"),
  ]);

  // Decrement unreadCount if message was unread
  if (wasUnread) {
    await decrementUnreadCount(kv, message.toBtcAddress);
  }

  // Grant "Communicator" achievement if not already earned
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

  // Generate reputationPayload (ERC-8004 feedbackHash) using Web Crypto API
  const hashData = new TextEncoder().encode(`${messageId}${reply}${signature}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", hashData);
  const feedbackHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const reputationPayload = {
    feedbackHash,
    tag1: "x402-inbox",
    tag2: "reply",
  };

  logger.info("Reply stored", {
    messageId,
    fromAddress: outboxReply.fromAddress,
    toBtcAddress: outboxReply.toBtcAddress,
  });

  return NextResponse.json(
    {
      success: true,
      message: "Reply sent successfully",
      reply: {
        messageId,
        fromAddress: outboxReply.fromAddress,
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

  // Fetch all messages with replies inline (single call, no N+1)
  const { replies: replyMap } = await listInboxMessages(
    kv,
    agent.btcAddress,
    100,
    0,
    { includeReplies: true }
  );

  // Collect all replies
  const validReplies = Array.from(replyMap.values());

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
