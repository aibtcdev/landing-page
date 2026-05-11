// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is public; PATCH (mark-read)
// uses verifyBitcoinSignature for caller auth on writes but does not cache.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  getMessage,
  updateMessage,
  validateMarkRead,
  buildMarkReadMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import { shouldFailClosed } from "@/lib/env";
import { updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";
import {
  getInboxMessageFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";

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

  // Phase 2.5 Step 3.2 — D1 read flip.
  // getInboxMessageFromD1 binds both messageId AND btcAddress (address-match guard):
  //   WHERE message_id = ? AND to_btc_address = ?
  // A mismatched address returns null → 404 (not a disclosure leak).
  // The AND clause is the load-bearing security gate (issue #725 block-on-merge).
  let message, repliesMap;
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

  // Fetch message
  const message = await getMessage(kv, messageId);

  if (!message) {
    return NextResponse.json(
      {
        error: "Message not found",
        messageId,
      },
      { status: 404 }
    );
  }

  // Verify message belongs to this agent (compare resolved BTC address)
  if (message.toBtcAddress !== agent.btcAddress) {
    return NextResponse.json(
      {
        error: "Message does not belong to this address",
        messageId,
      },
      { status: 403 }
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

  // Update message with readAt timestamp
  const now = new Date().toISOString();
  const updatedMessage = await updateMessage(kv, messageId, { readAt: now });

  if (!updatedMessage) {
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 }
    );
  }

  // Decrement unreadCount on the agent inbox index (clamped to 0)
  await decrementUnreadCount(kv, message.toBtcAddress);

  // D1 dual-write (Phase 2.5 Step 3 readiness).
  // KV is still the source of truth; D1 UPDATE is fire-and-forget.
  // D1 failure is logged-and-swallowed — it must NOT fail the response.
  if (env.DB) {
    ctx.waitUntil(
      updateMessageStateD1(env.DB as D1Database, messageId, { readAt: now }).catch((err) =>
        logger.error("mark_read.dual_write_d1_failed", {
          messageId,
          path: "mark_read",
          error: String(err),
        })
      )
    );
  }

  return NextResponse.json({
    success: true,
    message: "Message marked as read",
    messageId,
    readAt: now,
  });
}
