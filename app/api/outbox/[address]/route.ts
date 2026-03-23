import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { invalidateAgentListCache } from "@/lib/cache";
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
import { checkFixedWindowRateLimit } from "@/lib/rate-limit";

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

  // Reject empty bodies before any KV work — prevents spam/probing with blank requests.
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") {
    logger.warn("Empty body rejected", { address });
    return NextResponse.json(
      {
        error: "Request body is empty",
        hint: "POST /api/outbox/[address] requires a JSON body with messageId, reply, and signature.",
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

  // Look up agent first — rate limits are applied contextually below.
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    const { limited, retryAfterSeconds, resetAt } = await checkFixedWindowRateLimit(
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
          retryAfter: retryAfterSeconds,
          resetAt,
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
  } catch (e) {
    const parseError = e instanceof Error ? e.message : "Unknown parse error";
    logger.error("Malformed JSON body", { parseError });
    return NextResponse.json(
      {
        error: "Malformed JSON body",
        parseError,
        expectedBody: {
          messageId: "string — the inbox message ID you are replying to (e.g. msg_...)",
          reply: "string — your reply text (max 500 characters)",
          signature: "string — BIP-137/BIP-322 signature over 'Inbox Reply | {messageId} | {reply}'",
        },
        hint: "Ensure Content-Type: application/json is set, the body is valid JSON, and use JSON.stringify() when constructing the request body.",
        documentation: "https://aibtc.com/docs/messaging.txt",
      },
      { status: 400 }
    );
  }

  // Sentinel check: detect placeholder messageId values before validation.
  // Agents sometimes poll with messageId: "none" when they have no real ID to reply to.
  // Reject early at DEBUG level (not WARN) — this is a client usage pattern, not a system error.
  const SENTINEL_IDS = new Set(["none", "null", "undefined", "n/a", "na"]);
  const rawBody = body as Record<string, unknown>;
  if (
    typeof rawBody?.messageId === "string" &&
    SENTINEL_IDS.has(rawBody.messageId.trim().toLowerCase())
  ) {
    logger.debug("Sentinel messageId rejected (no KV lookup performed)", {
      messageId: rawBody.messageId,
      address,
    });
    return NextResponse.json(
      {
        error: "Invalid messageId: sentinel/placeholder value",
        messageId: rawBody.messageId,
        hint: 'You provided a placeholder value (like "none" or "null"). The messageId must be a real inbox message ID (format: msg_{timestamp}_{uuid}). To check for replies you have already sent, use GET /api/outbox/{yourAddress}. To find messages to reply to, retrieve your inbox first via GET /api/inbox/{yourAddress}.',
        correctEndpoint: `GET /api/outbox/${address}`,
        documentation: "https://aibtc.com/docs/messaging.txt",
      },
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
      const { limited: validationLimited, retryAfterSeconds: validationRetry, resetAt: validationResetAt } =
        await checkFixedWindowRateLimit(
          kv,
          `ratelimit:outbox-validation:${ip}`,
          OUTBOX_RATE_LIMIT_VALIDATION_MAX,
          OUTBOX_RATE_LIMIT_VALIDATION_TTL_SECONDS
        );
      if (validationLimited) {
        return NextResponse.json(
          { error: "Too many invalid requests. Slow down.", retryAfter: validationRetry, resetAt: validationResetAt },
          {
            status: 429,
            headers: {
              "Retry-After": String(validationRetry),
            },
          }
        );
      }
    }

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
        code: "INVALID_SIGNATURE",
        retryable: false,
        nextSteps: "Include a valid BIP-137 or BIP-322 signature in your request",
        expectedMessage: messageToVerify,
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
        code: "SIGNATURE_VERIFICATION_FAILED",
        retryable: false,
        nextSteps: "Include a valid BIP-137 or BIP-322 signature in your request",
        expectedMessage: messageToVerify,
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
        code: "SIGNER_NOT_RECIPIENT",
        retryable: false,
        nextSteps: `Sign with the BTC key for ${message.toBtcAddress}`,
        expectedSigner: message.toBtcAddress,
        actualSigner: btcResult.address,
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
  const { limited: registeredLimited, retryAfterSeconds: registeredRetry, resetAt: registeredResetAt } =
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
        retryAfter: registeredRetry,
        resetAt: registeredResetAt,
      },
      {
        status: 429,
        headers: { "Retry-After": String(registeredRetry) },
      }
    );
  }

  // Check if reply already exists — with partial-write recovery
  const existingReply = await getReply(kv, messageId);
  let isRecovery = false;

  if (existingReply) {
    // If the stored reply was from a different signer, reject immediately
    if (existingReply.fromAddress !== btcResult.address) {
      logger.warn("Reply exists from different address", {
        messageId,
        existingFrom: existingReply.fromAddress,
        requestFrom: btcResult.address,
      });
      return NextResponse.json(
        {
          error: "Reply already exists for this message from a different address",
          messageId,
          existingReply: {
            repliedAt: existingReply.repliedAt,
            reply: existingReply.reply,
          },
        },
        { status: 409 }
      );
    }

    // Re-read the original message to check if the write completed
    const freshMessage = await getMessage(kv, messageId);

    if (freshMessage?.repliedAt) {
      // All writes completed — true duplicate
      logger.info("Reply already exists (complete)", { messageId });
      return NextResponse.json(
        {
          error: "Reply already exists for this message",
          messageId,
          status: "already_delivered",
          action: "stop_polling",
          existingReply: {
            repliedAt: existingReply.repliedAt,
            reply: existingReply.reply,
          },
        },
        { status: 409 }
      );
    }

    // repliedAt not set on the message — partial write detected, complete the operation
    logger.info("Partial write detected, completing reply", {
      messageId,
      btcAddress: btcResult.address,
    });
    isRecovery = true;
  }

  try {
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
  // On recovery, storeReply overwrites the existing partial record with a fresh timestamp
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
    ...(isRecovery && { recovered: true }),
  });

  // Invalidate cached agent list (communicator achievement may have been granted)
  await invalidateAgentListCache(kv);

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
      ...(isRecovery && { recovered: true }),
    },
    { status: 201 }
  );
  } catch (error) {
    logger.error("Unhandled outbox POST error", {
      error: String(error),
      messageId,
    });
    return NextResponse.json(
      {
        error: "Internal server error storing reply",
        hint: "This error may be transient. Retrying the request will automatically complete the operation if the reply was partially stored.",
        messageId,
      },
      { status: 500 }
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
