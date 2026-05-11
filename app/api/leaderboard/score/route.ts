// CACHE_INVARIANTS:POSTURE=public-only-get
// Trading-comp leaderboard read surface. Public, pure-KV (one read of the
// cron-built snapshot). Edge-cached.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  readLeaderboardSnapshot,
  LEADERBOARD_REFRESH_INTERVAL_SECONDS,
} from "@/lib/competition/leaderboard";

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/leaderboard/score",
      method: "GET",
      description:
        "Trading-comp leaderboard ranked by USD P/L (historical, price-at-burn_block_time via Tenero OHLC). Returns the ranked list of registered agents who have at least one verified swap. Built by the leaderboard cron every 30 min — read here is pure KV (1 read of the persisted snapshot), no upstream fetches on the request path.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        rows: [
          {
            rank: "number (1-based)",
            stx_address: "string",
            btc_address: "string | null",
            display_name: "string | null",
            bns_name: "string | null",
            erc8004_agent_id: "number | null",
            trade_count: "number",
            priced_trade_count: "number",
            unpriced_trade_count: "number",
            volume_in_usd: "number",
            volume_out_usd: "number",
            pnl_usd: "number",
            first_trade_at: "number (unix seconds)",
            last_trade_at: "number (unix seconds)",
          },
        ],
        cachedAt: "string (ISO-8601) | null — when the snapshot was built. null means no snapshot exists yet (cron hasn't run, or 4 consecutive failures hit the TTL).",
        stats: {
          total_swaps: "number",
          total_agents: "number",
          priced_swap_count: "number",
          unpriced_swap_count: "number",
          price_window_from: "number (unix seconds — earliest OHLC bucket fetched)",
          price_window_to: "number (unix seconds — latest OHLC bucket fetched)",
        },
        refresh_interval_seconds: "number (the cadence the leaderboard cron runs at)",
      },
      notes: [
        `Refreshes every ${LEADERBOARD_REFRESH_INTERVAL_SECONDS / 60} min. cachedAt tells you the freshness; UI should surface it.`,
        "P/L is HISTORICAL — each leg priced against the Tenero OHLC close for the 1h bucket containing the swap's burn_block_time, not against today's price.",
        "Trades with a missing OHLC candle on either leg (Tenero gap or token outside TOKEN_DECIMALS) are counted in trade_count but excluded from pnl_usd to avoid imputing $0 to missing data.",
      ],
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const snapshot = await readLeaderboardSnapshot(kv, logger);

  if (!snapshot) {
    // Empty-snapshot shape — keeps the response schema stable so the UI
    // doesn't have to special-case "no data yet" with a different body
    // structure. The UI can show "Snapshot not yet built" based on
    // cachedAt === null.
    return NextResponse.json(
      {
        rows: [],
        cachedAt: null,
        stats: null,
        refresh_interval_seconds: LEADERBOARD_REFRESH_INTERVAL_SECONDS,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300",
        },
      }
    );
  }

  return NextResponse.json(
    {
      rows: snapshot.rows,
      cachedAt: snapshot.cachedAt,
      stats: snapshot.stats,
      refresh_interval_seconds: LEADERBOARD_REFRESH_INTERVAL_SECONDS,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      },
    }
  );
}
