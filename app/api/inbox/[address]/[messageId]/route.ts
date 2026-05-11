// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is public; PATCH (mark-read)
// uses verifyBitcoinSignature for caller auth on writes but does not cache.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateMarkRead,
  buildMarkReadMessage,
} from "@/lib/inbox";
import { shouldFailClosed } from "@/lib/env";
import { updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";
import {
  getInboxMessageFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

/** Retry-After value (seconds) to return on 429s — matches the 60s binding window. */
const RATE_LIMIT_RETRY_AFTER = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; messageId: string }> }
) {
  const { address, messageId } = await params;
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Resolve address (BTC or STX) to agent record
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        hint: "Check the agent directory at https://aibtc.com/agents",
      },
      { status: 404 }
    );
  }

  // Phase 2.5 Step 3.2 — D1 read flip. Security gate (composite WHERE message_id = ? AND to_btc_address = ?) in `getInboxMessageFromD1` (lib/inbox/d1-reads.ts); see #725 block-on-merge.
  let message: InboxMessage | null;
  let repliesMap: Map<string, OutboxReply>;
  try {
    const db = env.DB as D1Database;
    message = await getInboxMessageFromD1(db, agent.btcAddress, messageId);
    if (!message) {
      return NextResponse.json(
        {
          error: "Message not found",
          messageId,
          hint: "Check GET /api/inbox/[address] to see available messages",
        },
        { status: 404 }
      );
    }
    repliesMap = await fetchRepliesForMessages(db, [messageId]);
  } catch (e) {
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Inbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const reply = repliesMap.get(messageId) ?? null;

  // Resolve sender agent info (recipient is already `agent`)
  const senderAddr = message.senderBtcAddress || message.fromAddress;
  const senderAgent = await lookupAgent(kv, senderAddr);

  // Return message with reply and resolved peer info
  // Messages are immutable after delivery — cache aggressively
  return NextResponse.json(
    {
      message,
      reply,
      sender: senderAgent
        ? { btcAddress: senderAgent.btcAddress, stxAddress: senderAgent.stxAddress, displayName: senderAgent.displayName }
        : null,
      recipient: {
        btcAddress: agent.btcAddress,
        stxAddress: agent.stxAddress,
        displayName: agent.displayName,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600",
      },
    }
  );
}

// PATCH (mark-read) auth read flipped to D1 in Phase 2.5 Step 3.5 (#736).
// KV writes (updateMessage, decrementUnreadCount) removed in Phase 2.5 Step 4 (#730).
// D1 is now the sole write path; unreadCount served by live SELECT COUNT(*).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; messageId: string }> }
) {
  const { address, messageId } = await params;
  const { env, ctx } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  // IP bucket check — runs BEFORE verifyBitcoinSignature (the CPU-expensive
  // path) so signature-DoS spam from one IP gets clipped at the bucket limit.
  // IP-keyed only: spoofed `address` path-param cannot bypass an exhausted IP
  // quota. Mirrors agent-news#705 / outbox#705 IP-before-identity ordering.
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
  if (ip) {
    let ipLimited = false;
    try {
      const result = await env.RATE_LIMIT_MUTATING.limit({ key: `inbox-mark-read:${ip}` });
      ipLimited = !result.success;
    } catch (err) {
      // Binding unavailable — fail closed in production/preview, open in dev.
      // Mark-read is abuse-protection (not revenue), so prefer blocking on
      // binding errors over allowing signature-DoS during binding outages.
      const failClosed = shouldFailClosed(env);
      logger.warn("Mark-read rate limit binding error", { error: String(err), failClosed });
      if (failClosed) ipLimited = true;
    }
    if (ipLimited) {
      logger.warn("Mark-read rate limited (IP)", { ip });
      return NextResponse.json(
        { error: "Too many requests from this IP. Slow down.", retryAfter: RATE_LIMIT_RETRY_AFTER },
        { status: 429, headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) } }
      );
    }
  }

  // Resolve address (BTC or STX) to agent record
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        hint: "Check the agent directory at https://aibtc.com/agents",
      },
      { status: 404 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON body" },
      { status: 400 }
    );
  }

  // Validate mark-read request
  const validation = validateMarkRead(body);
  if (validation.errors) {
    return NextResponse.json(
      {
        error: "validation_failed",
        errors: validation.errors,
        docs_url: "https://aibtc.com/llms.txt",
      },
      { status: 400 }
    );
  }

  const { signature } = validation.data;

  // Verify messageId matches route param
  if (validation.data.messageId !== messageId) {
    return NextResponse.json(
      {
        error: "Message ID mismatch",
        expected: messageId,
        provided: validation.data.messageId,
      },
      { status: 400 }
    );
  }

  // Phase 2.5 Step 3.5 — fetch message from D1 instead of KV.
  // Security gate: getInboxMessageFromD1 uses WHERE message_id = ? AND to_btc_address = ?
  // AND is_reply = 0, so a mismatched address returns null → 404 (not 403 — avoids
  // leaking message existence to a non-recipient).
  // D1-throws fallback: 503 + Retry-After: 5 per Cycle 26 advisory (PR #732).
  const db = env.DB as D1Database | undefined;
  if (!db) {
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Inbox database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  let message: InboxMessage | null;
  try {
    message = await getInboxMessageFromD1(db, agent.btcAddress, messageId);
  } catch (e) {
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
    return NextResponse.json(
      {
        error: "Message not found",
        messageId,
      },
      { status: 404 }
    );
  }

  // Build expected message format
  const messageToVerify = buildMarkReadMessage(messageId);

  // Verify Bitcoin signature (supports BIP-137 and BIP-322)
  let btcResult;
  try {
    btcResult = verifyBitcoinSignature(
      signature,
      messageToVerify,
      message.toBtcAddress
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  if (!btcResult.valid) {
    return NextResponse.json(
      {
        error: "Bitcoin signature verification failed",
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  // Verify signer is recipient
  if (btcResult.address !== message.toBtcAddress) {
    return NextResponse.json(
      {
        error: "Signature verification failed: signer is not the recipient",
        expectedSigner: message.toBtcAddress,
        actualSigner: btcResult.address,
      },
      { status: 403 }
    );
  }

  // Check if already marked as read
  if (message.readAt) {
    return NextResponse.json(
      {
        error: "Message already marked as read",
        readAt: message.readAt,
      },
      { status: 409 }
    );
  }

  // D1 is now the sole write path (Phase 2.5 Step 4 — KV writes removed).
  // unreadCount is now a live SELECT COUNT(*) so no KV decrement is needed.
  //
  // D1 UPDATE is synchronous and failure-propagating: failure returns 503
  // + Retry-After: 5 so the caller can retry rather than seeing a phantom 200.
  const now = new Date().toISOString();
  try {
    await updateMessageStateD1(db, messageId, { readAt: now });
  } catch (err) {
    logger.error("mark_read.d1_update_failed", {
      messageId,
      path: "mark_read",
      error: String(err),
    });
    return NextResponse.json(
      {
        error: "Mark-read failed. Please retry shortly.",
        retryable: true,
        retryAfter: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Message marked as read",
    messageId,
    readAt: now,
  });
}
