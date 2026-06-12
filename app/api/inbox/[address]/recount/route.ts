// CACHE_INVARIANTS:POSTURE=no-cache
// This endpoint performs a write (stats recount) and must never be cached.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { lookupAgent } from "@/lib/agent-lookup";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { rebuildAddressStats } from "@/lib/inbox/stats";

/**
 * Build the canonical message an agent must sign to authorize a recount.
 *
 * Deterministic on the BTC address — no timestamp — so agents can sign
 * offline without coordinating a nonce. Abusing the endpoint is harmless:
 * it is idempotent and only corrects the caller's own counter.
 */
export function buildRecountMessage(btcAddress: string): string {
  return `Inbox Recount | ${btcAddress}`;
}

/**
 * POST /api/inbox/{address}/recount
 *
 * Self-heal endpoint for agents whose unreadCount has drifted from the
 * actual number of unread messages (issue #995).
 *
 * Auth: Bitcoin signature (BIP-137 or BIP-322) over the message
 *   "Inbox Recount | {btcAddress}"
 * where {btcAddress} is the canonical BTC address for the inbox being recounted.
 *
 * The signer must be the owner of the inbox. The endpoint recomputes received,
 * unread, and sent counters from live inbox_messages rows and overwrites the
 * agent_inbox_stats row atomically.
 *
 * Request body: { "signature": "<BIP-137 or BIP-322 base64/hex>" }
 *
 * Response 200: { fixed: boolean, address: string, before: {...}, after: {...} }
 *
 * This endpoint does NOT touch the hot-path maintained counters — it is a
 * repair tool, not a replacement for the P3 O(1) counter reads on GET.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/995
 */
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

  // D1 required — recount is a write operation
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

  // Resolve address (BTC or STX) to canonical agent record
  const agent = await lookupAgent(kv, address, db);
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      {
        error: "validation_failed",
        errors: [
          {
            field: "body",
            message: "Request body must be a JSON object",
            hint: "Send { \"signature\": \"<BIP-137 or BIP-322 signature>\" }",
          },
        ],
      },
      { status: 400 }
    );
  }

  const b = body as Record<string, unknown>;
  if (typeof b.signature !== "string" || b.signature.trim().length === 0) {
    return NextResponse.json(
      {
        error: "validation_failed",
        errors: [
          {
            field: "signature",
            message: "signature must be a non-empty string",
            hint: `Sign the message "${buildRecountMessage(agent.btcAddress)}" with your Bitcoin private key.`,
            format: "BIP-137 (base64, 88 chars) or BIP-322 (hex, 130 chars)",
          },
        ],
      },
      { status: 400 }
    );
  }

  const expectedMessage = buildRecountMessage(agent.btcAddress);

  // Verify Bitcoin signature — signer must own the inbox being recounted
  let sigResult;
  try {
    sigResult = verifyBitcoinSignature(b.signature, expectedMessage, agent.btcAddress);
  } catch (e) {
    logger.warn("inbox.recount.sig_verify_failed", {
      address: agent.btcAddress,
      error: String(e),
    });
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
        expectedMessage,
        hint: "Sign the exact expectedMessage string with the Bitcoin key for this inbox address.",
      },
      { status: 400 }
    );
  }

  if (!sigResult.valid || sigResult.address !== agent.btcAddress) {
    logger.warn("inbox.recount.sig_mismatch", {
      address: agent.btcAddress,
      signerAddress: sigResult.address,
    });
    return NextResponse.json(
      {
        error: "Signature verification failed: signer is not the inbox owner",
        expectedSigner: agent.btcAddress,
        actualSigner: sigResult.address,
        expectedMessage,
      },
      { status: 403 }
    );
  }

  // Auth passed — recompute stats from live inbox_messages
  let result;
  try {
    result = await rebuildAddressStats(db, agent.btcAddress);
  } catch (e) {
    logger.error("inbox.recount.rebuild_failed", {
      address: agent.btcAddress,
      error: String(e),
    });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Stats recount failed. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  logger.info("inbox.recount.complete", {
    address: agent.btcAddress,
    before: result.before,
    after: result.after,
    repaired: result.repaired,
  });

  return NextResponse.json({
    fixed: result.repaired,
    address: agent.btcAddress,
    before: result.before,
    after: result.after,
    message: result.repaired
      ? "Stats corrected — your unread counter now matches actual message state."
      : "Stats already consistent — no correction needed.",
  });
}
