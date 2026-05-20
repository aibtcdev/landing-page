// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// Read-only surface for finalized competition rounds; no auth, no per-caller branching.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { shouldFailClosed } from "@/lib/env";
import { listFinalizedRounds } from "@/lib/competition/finalize/read";

const RATE_LIMIT_RETRY_AFTER = 60;

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/rounds",
      method: "GET",
      description:
        "Paginated list of finalized competition rounds, newest first. Only rounds with status in (finalized, partially_paid, paid) are returned — in-flight rounds are excluded.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
        limit: {
          type: "number",
          description: `Page size, ${MIN_LIMIT}-${MAX_LIMIT}, default ${DEFAULT_LIMIT}`,
          example: "?limit=10",
        },
        offset: {
          type: "number",
          description: "Number of rounds to skip, default 0",
          example: "?offset=20",
        },
      },
      responseFormat: {
        rounds: [
          {
            round_id: "string (e.g. week-1-2026-05-13)",
            starts_at: "number (unix epoch seconds)",
            ends_at: "number (unix epoch seconds)",
            grace_ends_at: "number (unix epoch seconds)",
            status: "string (finalized | partially_paid | paid)",
            min_volume_usd: "number",
            min_priced_trade_count: "number",
            created_at: "string (ISO-8601)",
            finalized_at: "string | null (ISO-8601)",
          },
        ],
        pagination: {
          limit: "number",
          offset: "number",
          hasMore: "boolean (true if more rounds exist beyond this page)",
        },
      },
      relatedEndpoints: {
        roundDetail: "GET /api/competition/rounds/{roundId} — full round detail with results and rewards",
        agentResult:
          "GET /api/competition/rounds/{roundId}/results/{stxAddress} — per-agent result permalink",
        status: "GET /api/competition/status?address={stx} — agent trading status + latest round result",
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

  // Parse and validate limit
  const limitParam = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: `Invalid limit. Expected integer in [${MIN_LIMIT}, ${MAX_LIMIT}].` },
        { status: 400 }
      );
    }
    limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
  }

  // Parse and validate offset
  const offsetParam = searchParams.get("offset");
  let offset = 0;
  if (offsetParam !== null) {
    const parsed = parseInt(offsetParam, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "Invalid offset. Expected non-negative integer." },
        { status: 400 }
      );
    }
    offset = parsed;
  }

  // IP-keyed read rate limit (300/min).
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  let ipLimited = false;
  try {
    const result = await env.RATE_LIMIT_READ.limit({ key: `comp-rounds-list:${ip}` });
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
    logger.warn("D1 binding missing on competition/rounds");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  // Fetch one extra row to determine hasMore without a COUNT query.
  let rounds;
  try {
    rounds = await listFinalizedRounds(db, { limit: limit + 1, offset });
  } catch (err) {
    logger.warn("D1 read failed on competition/rounds", { error: String(err) });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const hasMore = rounds.length > limit;
  if (hasMore) {
    rounds = rounds.slice(0, limit);
  }

  return NextResponse.json(
    { rounds, pagination: { limit, offset, hasMore } },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
  );
}
