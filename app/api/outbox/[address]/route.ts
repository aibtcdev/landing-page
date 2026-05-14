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
  buildReplyMessage,
} from "@/lib/inbox";
import { isStxAddress } from "@/lib/validation/address";
import { shouldFailClosed } from "@/lib/env";
import { insertReplyToD1, updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";
import { bumpSentStats } from "@/lib/inbox/stats";
import {
  listOutboxRepliesFromD1,
  countOutboxRepliesFromD1,
  getInboxMessageFromD1,
  getReplyForMessageFromD1,
} from "@/lib/inbox/d1-reads";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

/** Retry-After value (seconds) to return on 429s — matches the 60s binding window. */
const RATE_LIMIT_RETRY_AFTER = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const { env, ctx } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const db = env.DB as D1Database | undefined;
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
  const agent = await lookupAgent(kv, address, db);

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

  // Phase 2.5 Step 3.5 — fetch original message from D1 instead of KV.
  // Security gate: getInboxMessageFromD1 uses WHERE message_id = ? AND to_btc_address = ?
  // AND is_reply = 0, so messages addressed to a different agent return null → 404.
  // This prevents a replier from replying to a message they are not the recipient of.
  // D1-throws fallback: 503 + Retry-After: 5 per Cycle 26 advisory (PR #732).
  if (!db) {
    logger.warn("D1 database binding unavailable", { messageId });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Inbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  // Note: agent.btcAddress is the URL path address (resolved from BTC or STX).
  // The SQL gate ensures we only fetch messages addressed to this agent.
  let message: InboxMessage | null;
  try {
    message = await getInboxMessageFromD1(db, agent.btcAddress, messageId);
  } catch (e) {
    logger.error("D1 message fetch failed", { messageId, error: String(e) });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Inbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

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

  // Phase 2.5 Step 3.5 — check for duplicate reply via D1 instead of KV.
  // New helper: getReplyForMessageFromD1 uses WHERE reply_to_message_id = ? AND
  // from_btc_address = ? AND is_reply = 1. The from_btc_address gate is the
  // tenant-discriminator: only a prior reply by THIS agent blocks the duplicate
  // check. A reply from a different agent to the same parent does NOT trigger 409.
  // D1-throws fallback: 503 + Retry-After: 5 per Cycle 26 advisory.
  let existingReply: OutboxReply | null;
  try {
    existingReply = await getReplyForMessageFromD1(db, messageId, btcResult.address);
  } catch (e) {
    logger.error("D1 duplicate-reply check failed", { messageId, error: String(e) });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Inbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  let isRecovery = false;

  if (existingReply) {
    // existingReply.fromAddress will always equal btcResult.address here because
    // getReplyForMessageFromD1 already gates on from_btc_address = btcResult.address.
    // The "different address" check from the KV path is now implicit in the SQL gate
    // (a reply by a different agent simply won't be returned).

    // Re-read the original message from D1 to check if the write completed.
    // Preserves the partial-write recovery semantic from the KV path:
    // if repliedAt is set on the message, the full write is confirmed (true duplicate).
    // Phase 2.5 Step 3.5 — freshMessage re-read uses D1 instead of KV.
    let freshMessage: InboxMessage | null;
    try {
      freshMessage = await getInboxMessageFromD1(db, agent.btcAddress, messageId);
    } catch (e) {
      logger.error("D1 fresh-message re-read failed (partial-write recovery)", {
        messageId,
        error: String(e),
      });
      return NextResponse.json(
        {
          error: "transient_d1_unavailable",
          message: "Inbox database temporarily unavailable. Please retry shortly.",
          retry_after: 5,
        },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

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

  // D1 is now the sole write path (Phase 2.5 Step 4 — KV writes removed).
  // unreadCount is now a live SELECT COUNT(*) so no KV decrement is needed.
  //
  // insertReplyToD1 is synchronous + failure-propagating: failure returns 503
  // + Retry-After: 5 so the sender retries rather than losing the reply.
  // Note: insertReplyToD1 resolves outboxReply.toBtcAddress (may be STX) to BTC
  // via KV lookup before inserting.
  //
  // updateMessageStateD1 sets replied_at (and read_at if unread) on the parent
  // message row. Failure here is logged-and-swallowed: the reply row already
  // committed, so the parent state update is best-effort metadata (the reply
  // content itself is durable). This matches the prior fire-and-forget pattern
  // for the parent state update.
  let replyInsertResult: { changes: number };
  try {
    replyInsertResult = await insertReplyToD1(db, kv, outboxReply);
  } catch (err) {
    logger.error("outbox.d1_insert_failed", {
      messageId: outboxReply.messageId,
      error: String(err),
    });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Reply delivery failed. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  // Best-effort: update parent message's replied_at (and read_at if unread).
  // The reply row is already committed; this is metadata only.
  const wasUnread = !message.readAt;
  const parentUpdates: { readAt?: string; repliedAt?: string } = {
    repliedAt: now,
    ...(wasUnread && { readAt: now }),
  };
  ctx.waitUntil(
    updateMessageStateD1(db, messageId, parentUpdates).catch((err) =>
      logger.error("outbox.d1_parent_state_failed", {
        messageId,
        error: String(err),
      })
    )
  );

  // Bump sent stats only on a real insert (changes === 1), not on recovery replay.
  // fromAddress is the agent's BTC address (message.toBtcAddress resolved above).
  if (replyInsertResult.changes === 1) {
    ctx.waitUntil(
      bumpSentStats(db, outboxReply.fromAddress, now).catch(() => {
        // Best-effort: stats drift is detectable via reconciliation.
      })
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
  const db = env.DB as D1Database | undefined;

  // Look up agent
  const agent = await lookupAgent(kv, address, db);

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

  // ── Phase 2.5 Step 3.3: D1 read flip ──────────────────────────────────────
  // The GET /api/outbox/[address] path now reads from D1 instead of KV.
  // KV writes (POST handler) are NOT removed in this PR — that is Step 4.
  // Security gate: listOutboxRepliesFromD1 filters by from_btc_address = ?
  // so replies belonging to a different agent are never returned.
  //
  // See: https://github.com/aibtcdev/landing-page/issues/728 (Step 3.3 spec)
  // See: https://github.com/aibtcdev/landing-page/issues/697 (Phase 2.5 umbrella)

  // Parse query params for pagination.
  // Validate before binding to D1: non-numeric inputs (e.g. ?limit=abc) must
  // produce 400, not 503 from a downstream D1 NaN bind throw.
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");

  let limit = 20;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "invalid_query_param", message: "limit must be an integer between 1 and 100" },
        { status: 400 }
      );
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetParam !== null) {
    const parsed = Number(offsetParam);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "invalid_query_param", message: "offset must be a non-negative integer" },
        { status: 400 }
      );
    }
    offset = parsed;
  }

  if (!db) {
    return NextResponse.json(
      { error: "Database unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  // D1-throws fallback policy (per #728 / #722 dev-council Cycle 26 advisory):
  // If D1 throws — transient unavailability, network error, schema mismatch —
  // return 503 with a structured retry hint rather than an unstructured 500.
  // totalCount is queried in parallel with the page list so pagination metadata
  // reflects the full matching row count, not just the current page length.
  let replies: OutboxReply[];
  let totalCount: number;
  try {
    [replies, totalCount] = await Promise.all([
      listOutboxRepliesFromD1(db, agent.btcAddress, limit, offset),
      countOutboxRepliesFromD1(db, agent.btcAddress),
    ]);
  } catch (e) {
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Outbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  // Self-documenting response only when the agent has truly never sent a
  // reply (totalCount === 0). Out-of-range pages (offset > 0 but the agent
  // does have history) get the normal envelope with empty `replies` and
  // accurate pagination so clients can recover.
  if (totalCount === 0) {
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
        pagination: {
          limit,
          offset,
          hasMore: false,
          nextOffset: null,
        },
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

  const hasMore = offset + replies.length < totalCount;
  return NextResponse.json({
    agent: {
      btcAddress: agent.btcAddress,
      displayName: agent.displayName,
    },
    outbox: {
      replies,
      totalCount,
      pagination: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + replies.length : null,
      },
    },
  });
}
