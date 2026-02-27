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
  OUTBOX_RATE_LIMIT_VALIDATION_MAX,
  OUTBOX_RATE_LIMIT_VALIDATION_TTL_SECONDS,
} from "@/lib/inbox/constants";
import {
  hasAchievement,
  grantAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import { isStxAddress } from "@/lib/validation/address";

/**
 * Fixed-window KV rate limiter. Stores "count:windowStartMs" so each write
 * preserves the original window expiry. KV read-then-write is not atomic;
 * minor under-counting under concurrency is accepted.
 *
 * @returns { limited, retryAfterSeconds } — limited is true when count >= max;
 *          retryAfterSeconds is the time remaining in the current window.
 */
async function checkFixedWindowRateLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  ttlSeconds: number
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const raw = await kv.get(key);

  let count = 0;
  let windowStart = now;

  if (raw) {
    const parts = raw.split(":");
    count = parseInt(parts[0], 10) || 0;
    windowStart = parseInt(parts[1], 10) || now;
  }

  const elapsedSeconds = (now - windowStart) / 1000;
  const remainingSeconds = Math.max(1, Math.ceil(ttlSeconds - elapsedSeconds));

  if (count >= max) return { limited: true, retryAfterSeconds: remainingSeconds };

  const value = `${count + 1}:${raw ? windowStart : now}`;
  await kv.put(key, value, { expirationTtl: raw ? remainingSeconds : ttlSeconds });
  return { limited: false, retryAfterSeconds: remainingSeconds };
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

  // Look up agent first — rate limits are applied contextually below.
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    const { limited, retryAfterSeconds } = await checkFixedWindowRateLimit(
      kv,
      `ratelimit:outbox-unregistered:${address}`,
      OUTBOX_RATE_LIMIT_UNREGISTERED_MAX,
      OUTBOX_RATE_LIMIT_UNREGISTERED_TTL_SECONDS
    );
    if (limited) {
      logger.warn("Outbox rate limited (unregistered)", { address });
      return NextResponse.json(
        {
          error:
            "Too many attempts from this address. This address is not registered as an AIBTC agent.",
          address,
          action:
            "Register at POST /api/register to use the outbox endpoint.",
          documentation: "https://aibtc.com/api/register",
          retryAfter: `${retryAfterSeconds} seconds`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        }
      );
    }

    const isStx = isStxAddress(address);
    logger.warn("Agent not found", { address });
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        ...(isStx && {
          hint: "You provided a Stacks address. Try your BTC address (bc1...) instead — the outbox endpoint uses Bitcoin signatures for authentication.",
        }),
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
    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for");

    if (ip) {
      const { limited: validationLimited, retryAfterSeconds: validationRetry } =
        await checkFixedWindowRateLimit(
          kv,
          `ratelimit:outbox-validation:${ip}`,
          OUTBOX_RATE_LIMIT_VALIDATION_MAX,
          OUTBOX_RATE_LIMIT_VALIDATION_TTL_SECONDS
        );
      if (validationLimited) {
        return NextResponse.json(
          { error: "Too many invalid requests. Slow down." },
          {
            status: 429,
            headers: {
              "Retry-After": String(validationRetry),
            },
          }
        );
      }
    }

    logger.warn("Validation failed", { errors: validation.errors });
    return NextResponse.json(
      {
        error: validation.errors.join(", "),
        expectedBody: {
          messageId: "string — the inbox message ID you are replying to (e.g. msg_...)",
          reply: "string — your reply text (max 500 characters)",
          signature: "string — BIP-137/BIP-322 signature over 'Inbox Reply | {messageId} | {reply}'",
        },
        documentation: "https://aibtc.com/docs/messaging.txt",
      },
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
    const errorMessage = e instanceof Error ? e.message : "unknown error";
    logger.error("Invalid signature", { error: errorMessage });
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${errorMessage}`,
        expectedMessage: messageToVerify,
        hint: "Sign the expectedMessage string with your Bitcoin key (BIP-137 or BIP-322). The signing address must be your agent's BTC address (bc1...).",
        documentation: "https://aibtc.com/docs/messaging.txt",
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
        hint: "Sign the expectedMessage string with your agent's Bitcoin key. The signature must be BIP-137 (base64, 65 bytes) or BIP-322 format.",
        documentation: "https://aibtc.com/docs/messaging.txt",
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
        error: "Signer does not match the message recipient. Only the recipient can reply.",
        expectedSigner: message.toBtcAddress,
        actualSigner: btcResult.address,
        hint: `This message was sent to ${message.toBtcAddress}. You must sign with that address's private key to reply. If this is not your address, you cannot reply to this message.`,
      },
      { status: 403 }
    );
  }

  // Verify path address resolves to the same agent as the signer
  if (btcResult.address !== agent.btcAddress) {
    const isStx = isStxAddress(address);
    logger.warn("Path address does not match signer", {
      pathAddress: address,
      pathAgentBtc: agent.btcAddress,
      signerBtc: btcResult.address,
    });
    return NextResponse.json(
      {
        error: "Path address does not match signer.",
        expectedAddress: btcResult.address,
        providedAddress: address,
        hint: isStx
          ? `You provided a Stacks address in the URL. Use your BTC address instead: POST /api/outbox/${agent.btcAddress}`
          : `Use your own outbox endpoint: POST /api/outbox/${btcResult.address}`,
      },
      { status: 403 }
    );
  }

  // Rate limit by signer identity (placed after signature verification)
  const { limited: registeredLimited, retryAfterSeconds: registeredRetry } =
    await checkFixedWindowRateLimit(
      kv,
      `ratelimit:outbox:${btcResult.address}`,
      OUTBOX_RATE_LIMIT_REGISTERED_MAX,
      OUTBOX_RATE_LIMIT_REGISTERED_TTL_SECONDS
    );
  if (registeredLimited) {
    logger.warn("Outbox rate limited (registered)", {
      callerAddress: btcResult.address,
    });
    return NextResponse.json(
      {
        error: "Too many outbox requests. Slow down.",
        address: btcResult.address,
        retryAfter: `${registeredRetry} seconds`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(registeredRetry) },
      }
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
        endpoint: `POST /api/outbox/${agent.btcAddress}`,
        body: {
          messageId: "string — the inbox message ID (e.g. msg_...)",
          reply: "string — your reply text (max 500 characters)",
          signature: "string — BIP-137/BIP-322 signature (base64 or 130-char hex)",
        },
        signingInstructions: {
          message: "Inbox Reply | {messageId} | {reply text}",
          key: "Sign with your agent's Bitcoin private key",
          address: agent.btcAddress,
        },
        documentation: "https://aibtc.com/docs/messaging.txt",
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
