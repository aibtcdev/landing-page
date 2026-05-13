// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// POST is the agent-submit verifier (Phase 3.1 PR-B).

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { isStxAddress } from "@/lib/validation/address";
import { shouldFailClosed } from "@/lib/env";
import {
  listSwapsFromD1,
  encodeSwapsCursor,
  decodeSwapsCursor,
} from "@/lib/competition/d1-reads";
import { verifyAndPersistSwap } from "@/lib/competition/verify";

const TXID_RE = /^(0x)?[0-9a-fA-F]{64}$/;

const RATE_LIMIT_RETRY_AFTER = 60;

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/trades",
      methods: ["GET", "POST"],
      description:
        "Trading-comp swap history. GET returns paginated trades; POST verifies a swap by txid.",
      get: {
        queryParameters: {
          docs: {
            type: "string",
            description: "Pass ?docs=1 to return this documentation payload instead of data",
            example: "?docs=1",
          },
          address: {
            type: "string",
            required: true,
            description: "Stacks mainnet address (SP… / SM…) to look up",
            example: "?address=SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
          },
          limit: {
            type: "number",
            description: `Page size, ${MIN_LIMIT}-${MAX_LIMIT}, default ${DEFAULT_LIMIT}`,
            example: "?limit=100",
          },
          cursor: {
            type: "string",
            description: "Opaque base64url cursor returned in `next_cursor`. Omit on first page.",
            example: "?cursor=eyJ0IjoxNzYyNTQ3ODkwLCJ4IjoiMHhhYmNkZWYifQ",
          },
        },
        responseFormat: {
          trades: [
            {
              txid: "string (Stacks tx hash, 0x-prefixed)",
              sender: "string (STX address)",
              contract_id: "string (e.g. SP….stableswap-stx-ststx-v-1-2)",
              function_name: "string (e.g. swap-x-for-y)",
              token_in: "string (input asset contract id)",
              amount_in: "number (raw on-chain units)",
              token_out: "string (output asset contract id)",
              amount_out: "number (raw on-chain units)",
              burn_block_time: "number (unix seconds)",
              tx_status: "string (success | abort_by_response | …)",
              source: "string ('agent' | 'cron' | 'chainhook'; 'cron' is SchedulerDO catch-up)",
              scored_value: "number | null",
              scored_at: "string | null (ISO-8601)",
            },
          ],
          next_cursor: "string | null (pass back as ?cursor= for the next page)",
        },
      },
      post: {
        description:
          "Submit a confirmed Stacks txid for verification. Callers (typically the AIBTC MCP server) must pre-check that the tx is terminal before submitting; the route checks D1 first (cheap idempotency gate), then fetches the tx from Hiro, runs sender + allowlist checks, parses the swap, and persists via INSERT OR IGNORE. First writer wins on `(txid)` across all ingestion paths (agent / scheduler); re-submits of an already-recorded txid return 409.",
        requestBody: { txid: "string — 64-char hex (0x-prefixed accepted)" },
        responses: {
          "200": "First-time verified — body is the persisted SwapRow",
          "202": "Pending fallback — should be rare since callers pre-check confirmation. Indicates Hiro has not yet propagated this tx as terminal (block just mined). Body: { accepted: true, note }. Retry in a few seconds.",
          "400": "Malformed txid",
          "404": "Hiro could not find the txid",
          "409": "Transaction already verified — this txid is already in the swaps table. Body: { error, code: 'txid_already_verified', retryable: false, existing_row }. The existing_row.source identifies which ingestion path wrote first.",
          "422": "Sender not registered, contract not on allowlist, parse failure, or terminal failure status",
          "429": "Rate limited — Retry-After header set",
          "502": "Upstream (Hiro) error — retryable",
          "503": "D1 temporarily unavailable — retryable",
        },
        rateLimit: "20/min per IP (RATE_LIMIT_MUTATING)",
      },
      relatedEndpoints: {
        status: "GET /api/competition/status?address={stx} — membership + counts",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return selfDocResponse();
  }

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const address = searchParams.get("address");
  if (!address || !isStxAddress(address)) {
    return NextResponse.json(
      {
        error: "Missing or invalid `address` query param. Expected a Stacks mainnet address (SP… / SM…).",
        example: "/api/competition/trades?address=SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      },
      { status: 400 }
    );
  }

  const limitParam = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: `Invalid limit. Expected integer in [${MIN_LIMIT}, ${MAX_LIMIT}].` },
        { status: 400 }
      );
    }
    limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
  }

  const cursorParam = searchParams.get("cursor");
  let cursor: { t: number; x: string } | null = null;
  if (cursorParam) {
    try {
      cursor = decodeSwapsCursor(cursorParam);
    } catch {
      return NextResponse.json(
        { error: "Invalid cursor. Pass the opaque value from a previous `next_cursor` response." },
        { status: 400 }
      );
    }
  }

  // IP-keyed read rate limit (300/min).
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  let ipLimited = false;
  try {
    const result = await env.RATE_LIMIT_READ.limit({ key: `comp-trades:${ip}` });
    ipLimited = !result.success;
  } catch (err) {
    const failClosed = shouldFailClosed(env);
    logger.warn("Rate limit binding error", { error: String(err), failClosed });
    if (failClosed) ipLimited = true;
  }
  if (ipLimited) {
    return NextResponse.json(
      { error: "Too many requests from this IP. Slow down.", retryAfter: RATE_LIMIT_RETRY_AFTER },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/trades");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  // Request one extra row beyond the page to detect whether more exist.
  // If the DB returns exactly limit+1, we have a next page; drop the extra
  // and synthesize a cursor from the *last* row of the returned page.
  let trades;
  try {
    trades = await listSwapsFromD1(db, address, limit + 1, cursor);
  } catch (err) {
    logger.warn("D1 read failed on competition/trades", { error: String(err), address });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  let nextCursor: string | null = null;
  if (trades.length > limit) {
    trades = trades.slice(0, limit);
    const last = trades[trades.length - 1];
    nextCursor = encodeSwapsCursor(last.burn_block_time, last.txid);
  }

  return NextResponse.json(
    { trades, next_cursor: nextCursor },
    { headers: { "Cache-Control": "public, max-age=10, s-maxage=10" } }
  );
}

/**
 * POST /api/competition/trades — agent-submit verifier (Phase 3.1 PR-B).
 *
 * Accepts { txid } and runs the single-tx verifier (see lib/competition/verify.ts).
 *   - 202 { accepted: true } when Hiro has not propagated terminal status yet
 *   - 200 with the persisted row when verified (newly written)
 *   - 409 with the existing row on idempotent re-submission
 *   - 422 with { error, code, retryable: false } on sender/allowlist/parse rejections
 *   - 4xx on malformed input, 429 on rate limit, 503 on D1 unavailability
 */
export async function POST(request: NextRequest) {
  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  let body: { txid?: unknown };
  try {
    body = (await request.json()) as { txid?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON: { txid: string }" },
      { status: 400 }
    );
  }

  const txid = typeof body.txid === "string" ? body.txid.trim() : "";
  if (!txid || !TXID_RE.test(txid)) {
    return NextResponse.json(
      {
        error: "Invalid `txid`. Expected a 64-character hex string (optionally 0x-prefixed).",
        retryable: false,
      },
      { status: 400 }
    );
  }
  const normalizedTxid = txid.startsWith("0x") ? txid : `0x${txid}`;

  // Mutating rate limit (20/min per IP). The handoff routes this through the
  // existing RATE_LIMIT_MUTATING binding — same bucket as inbox/outbox writes.
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  let limited = false;
  try {
    const result = await env.RATE_LIMIT_MUTATING.limit({ key: `comp-submit:${ip}` });
    limited = !result.success;
  } catch (err) {
    const failClosed = shouldFailClosed(env);
    logger.warn("Rate limit binding error", { error: String(err), failClosed });
    if (failClosed) limited = true;
  }
  if (limited) {
    return NextResponse.json(
      { error: "Too many submissions from this IP. Slow down.", retryAfter: RATE_LIMIT_RETRY_AFTER },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/trades POST");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const result = await verifyAndPersistSwap(env, db, normalizedTxid, "agent", logger);

  // Pending fallback: the MCP server pre-checks tx confirmation before
  // submitting, so this branch should be unreachable on the happy path.
  // It survives as defense in depth for the racy edge case where the
  // MCP saw the tx as confirmed but our Hiro fetch hasn't propagated
  // yet (block just mined). Caller should retry shortly. No D1 row is
  // written — migration 005 forbids 'pending' rows in `swaps`.
  if (result.status === "pending") {
    return NextResponse.json(
      {
        accepted: true,
        note: "Hiro has not yet propagated this tx as terminal. Retry in a few seconds.",
      },
      { status: 202 }
    );
  }

  if (result.status === "verified") {
    // Idempotent re-submit: the row already existed before this POST hit
    // the verifier. Return 409 Conflict (not 200) so the caller has an
    // unambiguous signal that this submit did NOT write the row. The
    // existing row is included so callers can reconcile (its `source`
    // identifies which ingestion path wrote first — agent / scheduler /
    // chainhook). retryable: false because re-POSTing the same txid will
    // keep landing here.
    if (!result.inserted) {
      return NextResponse.json(
        {
          error: "Transaction already verified for this competition",
          code: "txid_already_verified",
          retryable: false,
          existing_row: result.row,
        },
        { status: 409 }
      );
    }

    // First-time successful write. Body is the persisted SwapRow.
    return NextResponse.json(result.row, { status: 200 });
  }

  // result.status === "rejected"
  switch (result.code) {
    case "sender_not_registered":
    case "sender_not_genesis":
    case "contract_not_allowlisted":
    case "tx_failed":
    case "before_comp_start":
    case "invalid_amount":
    case "incomplete_events":
    case "malformed_tx":
      return NextResponse.json(
        { error: result.reason, code: result.code, retryable: false },
        { status: 422 }
      );
    case "tx_not_found":
      return NextResponse.json(
        { error: result.reason, code: result.code, retryable: false },
        { status: 404 }
      );
    case "tx_fetch_failed":
      return NextResponse.json(
        { error: result.reason, code: result.code, retryable: true },
        { status: 502, headers: { "Retry-After": "5" } }
      );
    case "db_unavailable":
      return NextResponse.json(
        {
          error: "transient_d1_unavailable",
          message: "Competition database temporarily unavailable. Please retry shortly.",
          retry_after: 5,
        },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    default: {
      // Exhaustiveness check — compile-time guard if a new code is added.
      const _exhaustive: never = result.code;
      void _exhaustive;
      return NextResponse.json(
        { error: result.reason, retryable: false },
        { status: 422 }
      );
    }
  }
}
