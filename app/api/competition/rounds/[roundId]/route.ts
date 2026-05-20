// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// Read-only detail surface for a single finalized competition round; no auth.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { shouldFailClosed } from "@/lib/env";
import {
  getFinalizedRound,
  getRoundResults,
  getRoundRewards,
} from "@/lib/competition/finalize/read";

const RATE_LIMIT_RETRY_AFTER = 60;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/rounds/{roundId}",
      method: "GET",
      description:
        "Full detail for a single finalized competition round: round metadata, all agent results ranked by overall P&L, and reward rows. Returns 404 when the round does not exist or is not yet finalized (open/closed/finalizing rounds are hidden).",
      pathParameters: {
        roundId: {
          type: "string",
          description: "Round identifier (e.g. week-1-2026-05-13)",
          example: "/api/competition/rounds/week-1-2026-05-13",
        },
      },
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        round: {
          round_id: "string",
          starts_at: "number (unix epoch seconds)",
          ends_at: "number (unix epoch seconds)",
          grace_ends_at: "number (unix epoch seconds)",
          status: "string (finalized | partially_paid | paid)",
          min_volume_usd: "number",
          min_priced_trade_count: "number",
          created_at: "string (ISO-8601)",
          finalized_at: "string | null (ISO-8601)",
        },
        results: [
          {
            rank: "number",
            stx_address: "string",
            btc_address: "string",
            erc8004_agent_id: "number | null",
            trade_count: "number",
            priced_trade_count: "number",
            unpriced_trade_count: "number",
            volume_usd: "number",
            received_usd: "number",
            pnl_usd: "number",
            pnl_percent: "number | null (null when volume_usd = 0)",
            latest_trade_at: "number | null (unix seconds)",
            result_json: {
              source_counts: "{ agent, cron, chainhook }",
              unpriced_tokens: "string[]",
            },
            calculated_at: "string (ISO-8601)",
          },
        ],
        rewards: [
          {
            category: "string (overall_pnl | volume | return)",
            rank: "number",
            stx_address: "string",
            erc8004_agent_id: "number | null",
            amount_sats: "number",
            status: "string (pending | paid | failed | void)",
            payout_txid: "string | null",
            paid_at: "string | null (ISO-8601)",
          },
        ],
      },
      errorResponses: {
        "404": "round_not_found — round does not exist or is not yet finalized",
        "503": "transient_d1_unavailable — database temporarily unavailable",
      },
      relatedEndpoints: {
        rounds: "GET /api/competition/rounds — paginated list of finalized rounds",
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return selfDocResponse();
  }

  const { roundId } = await params;

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  // IP-keyed read rate limit (300/min).
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  let ipLimited = false;
  try {
    const result = await env.RATE_LIMIT_READ.limit({ key: `comp-round-detail:${ip}` });
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
    logger.warn("D1 binding missing on competition/rounds/[roundId]");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  let round, results, rewards;
  try {
    round = await getFinalizedRound(db, roundId);
    if (!round) {
      return NextResponse.json(
        {
          error: "round_not_found",
          message:
            "Competition round not found or not yet finalized. Only rounds with status finalized, partially_paid, or paid are publicly visible.",
        },
        { status: 404 }
      );
    }

    [results, rewards] = await Promise.all([
      getRoundResults(db, roundId),
      getRoundRewards(db, roundId),
    ]);
  } catch (err) {
    logger.warn("D1 read failed on competition/rounds/[roundId]", {
      error: String(err),
      roundId,
    });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  return NextResponse.json(
    { round, results, rewards },
    // Finalized rounds are immutable — cache aggressively.
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } }
  );
}
