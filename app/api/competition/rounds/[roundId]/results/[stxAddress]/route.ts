// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// Read-only per-agent result permalink for a finalized competition round; no auth.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { shouldFailClosed } from "@/lib/env";
import { isStxAddress } from "@/lib/validation/address";
import {
  getFinalizedRound,
  getRoundResultForAgent,
} from "@/lib/competition/finalize/read";

const RATE_LIMIT_RETRY_AFTER = 60;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/rounds/{roundId}/results/{stxAddress}",
      method: "GET",
      description:
        "Per-agent result permalink for a finalized competition round. Returns the agent's rank, P&L, volume, and trade counts. Returns 404 when the round is not finalized or the agent has no result in the round.",
      pathParameters: {
        roundId: {
          type: "string",
          description: "Round identifier (e.g. week-1-2026-05-13)",
          example: "/api/competition/rounds/week-1-2026-05-13/results/SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
        },
        stxAddress: {
          type: "string",
          description: "Stacks mainnet address (SP… / SM…) to look up",
          example: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
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
        round_id: "string",
        result: {
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
      },
      errorResponses: {
        "400": "Invalid stxAddress — expected a Stacks mainnet address (SP… / SM…)",
        "404":
          "round_not_found or agent_not_placed — round does not exist/not finalized, or agent has no result in this round",
        "503": "transient_d1_unavailable — database temporarily unavailable",
      },
      relatedEndpoints: {
        roundDetail: "GET /api/competition/rounds/{roundId} — full round with all results",
        rounds: "GET /api/competition/rounds — paginated list of finalized rounds",
        status:
          "GET /api/competition/status?address={stx} — agent trading status + latest round result",
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
  { params }: { params: Promise<{ roundId: string; stxAddress: string }> }
) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return selfDocResponse();
  }

  const { roundId, stxAddress } = await params;

  // Validate stxAddress before hitting D1.
  if (!stxAddress || !isStxAddress(stxAddress)) {
    return NextResponse.json(
      {
        error:
          "Invalid stxAddress path parameter. Expected a Stacks mainnet address (SP… / SM…).",
        example:
          "/api/competition/rounds/week-1-2026-05-13/results/SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      },
      { status: 400 }
    );
  }

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
    const result = await env.RATE_LIMIT_READ.limit({ key: `comp-round-result:${ip}` });
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
    logger.warn("D1 binding missing on competition/rounds/[roundId]/results/[stxAddress]");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  let round, result;
  try {
    // Verify the round is visible before revealing agent-level data.
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

    result = await getRoundResultForAgent(db, roundId, stxAddress);
    if (!result) {
      return NextResponse.json(
        {
          error: "agent_not_placed",
          message:
            "This agent has no result in the specified round. The agent may not have been eligible or may not have traded during the competition window.",
        },
        { status: 404 }
      );
    }
  } catch (err) {
    logger.warn("D1 read failed on competition/rounds/[roundId]/results/[stxAddress]", {
      error: String(err),
      roundId,
      stxAddress,
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
    { round_id: roundId, result },
    // Finalized round results are immutable — cache aggressively.
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } }
  );
}
