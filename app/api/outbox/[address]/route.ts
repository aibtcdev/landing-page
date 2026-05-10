// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is public; POST (reply) uses
// verifyBitcoinSignature for caller auth on writes but does not cache.

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
import { isStxAddress } from "@/lib/validation/address";
import { shouldFailClosed } from "@/lib/env";
import { insertReplyToD1, updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";

/** Retry-After value (seconds) to return on 429s — matches the 60s binding window. */
const RATE_LIMIT_RETRY_AFTER = 60;

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

  // IP bucket check — must run BEFORE any address-keyed check so that spoofed
  // path addresses cannot bypass an exhausted IP quota. Mirrors agent-news#705.
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
  if (ip) {
    let ipLimited = false;
    try {
      const result = await env.RATE_LIMIT_MUTATING.limit({ key: `outbox-ip:${ip}` });
      ipLimited = !result.success;
    } catch (err) {
      // Binding unavailable — fail closed in production/preview, open in dev.
      const failClosed = shouldFailClosed(env);
      logger.warn("IP rate limit binding error", { error: String(err), failClosed });
      if (failClosed) ipLimited = true;
    }
    if (ipLimited) {
      logger.warn("Outbox rate limited (IP)", { ip });
      return NextResponse.json(
        { error: "Too many requests from this IP. Slow down.", retryAfter: RATE_LIMIT_RETRY_AFTER },
        { status: 429, headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) } }
      );
    }
  }

  // Look up agent — rate limit unregistered addresses after IP check passes.
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    let unregLimited = false;
    try {
      const result = await env.RATE_LIMIT_MUTATING.limit({ key: `outbox-unregistered:${address}` });
      unregLimited = !result.success;
    } catch (err) {
      const failClosed = shouldFailClosed(env);
      logger.warn("Unregistered rate limit binding error", { error: String(err), failClosed });
      if (failClosed) unregLimited = true;
    }
    if (unregLimited) {
      logger.warn("Outbox rate limited (unregistered)", { address });
      return NextResponse.json(
        {
          error:
            "Too many attempts from this address. This address is not registered as an AIBTC agent.",
          address,
          action:
            "Register at POST /api/register to use the outbox endpoint.",
          documentation: "https://aibtc.com/api/register",
          retryAfter: RATE_LIMIT_RETRY_AFTER,
        },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) },
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
    // IP bucket was already checked above — validation failures consume the same bucket.
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

  // Authenticated rate limit — keyed on verified signer identity.
  // Placed after signature verification so the key is cryptographically bound.
  // IP bucket already passed above; this is the per-identity follow-on check.
  let registeredLimited = false;
  try {
    const result = await env.RATE_LIMIT_AUTHENTICATED.limit({ key: `outbox:${btcResult.address}` });
    registeredLimited = !result.success;
  } catch (err) {
    const failClosed = shouldFailClosed(env);
    logger.warn("Authenticated rate limit binding error", { error: String(err), failClosed });
    if (failClosed) registeredLimited = true;
  }
  if (registeredLimited) {
    logger.warn("Outbox rate limited (registered)", {
      callerAddress: btcResult.address,
    });
    return NextResponse.json(
      {
        error: "Too many outbox requests. Slow down.",
        address: btcResult.address,
        retryAfter: RATE_LIMIT_RETRY_AFTER,
      },
      {
        status: 429,
        headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) },
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

  // Store reply and update message (also mark as read) in parallel
  // On recovery, storeReply overwrites the existing partial record with a fresh timestamp
  await Promise.all([
    storeReply(kv, outboxReply),
    updateMessage(kv, messageId, {
      repliedAt: now,
      ...(!message.readAt && { readAt: now }),
    }),
  ]);

  // Decrement unreadCount if message was unread
  if (wasUnread) {
    await decrementUnreadCount(kv, message.toBtcAddress);
  }

  // D1 dual-write (Phase 2.5 Step 1 — reversible scaffolding).
  // KV is still the source of truth; D1 INSERT is fire-and-forget.
  // D1 failure is logged-and-swallowed — it must NOT fail the response.
  // Note: insertReplyToD1 resolves outboxReply.toBtcAddress (may be STX) to BTC
  // via KV lookup before inserting. If resolution fails, it throws and the catch
  // logs it as a dual-write failure.
  if (env.DB) {
    ctx.waitUntil(
      insertReplyToD1(env.DB as D1Database, kv, outboxReply).catch((err) =>
        logger.error("outbox.dual_write_d1_failed", {
          messageId: outboxReply.messageId,
          path: "kv_reply",
          error: String(err),
        })
      )
    );

    // D1 dual-write for the PARENT message's read_at / replied_at state
    // (Phase 2.5 Step 3 readiness — closes the updateMessage dual-write gap).
    // The outbox POST updates the parent message in KV (sets repliedAt + possibly readAt).
    // We mirror that here. Target is the parent's message_id directly — no derivation.
    // wasUnread reflects whether readAt is being set for the first time.
    const parentUpdates: { readAt?: string; repliedAt?: string } = {
      repliedAt: now,
      ...(wasUnread && { readAt: now }),
    };
    ctx.waitUntil(
      updateMessageStateD1(env.DB as D1Database, messageId, parentUpdates).catch((err) =>
        logger.error("outbox.dual_write_d1_parent_state_failed", {
          messageId,
          path: "kv_reply_parent_state",
          error: String(err),
        })
      )
    );
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
