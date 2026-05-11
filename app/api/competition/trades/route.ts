// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// POST stub returns 501 until PR-B (verifier worker) ships.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { isStxAddress } from "@/lib/validation/address";
import { shouldFailClosed } from "@/lib/env";
import {
  listSwapsFromD1,
  countSwapsFromD1,
  encodeSwapsCursor,
  decodeSwapsCursor,
} from "@/lib/competition/d1-reads";

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
        "Trading-comp swap history. GET returns paginated trades; POST verifies a swap by txid (ships in Phase 3.1 PR-B; currently 501 Not Implemented).",
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
              source: "string ('agent' | 'cron' | 'chainhook')",
              scored_value: "number | null",
              scored_at: "string | null (ISO-8601)",
            },
          ],
          next_cursor: "string | null (pass back as ?cursor= for the next page)",
        },
      },
      post: {
        status: "501 Not Implemented",
        shipsIn: "Phase 3.1 PR-B",
        description:
          "Will accept { txid } and verify against Hiro + insert into swaps. Currently a placeholder so the route is reservation-stable.",
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

export async function POST() {
  // Phase 3.1 PR-A only ships read routes. The verifier worker — Hiro fetch,
  // allowlist check, INSERT OR IGNORE — lands in PR-B (#734). Returning 501
  // (not 405) so callers know the *method* is allocated but not yet wired.
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "POST /api/competition/trades ships in Phase 3.1 PR-B. The route is reserved; the verifier worker is not yet wired.",
      docs: "/api/competition/trades?docs=1",
    },
    { status: 501 }
  );
}
