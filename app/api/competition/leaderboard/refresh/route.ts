// CACHE_INVARIANTS:POSTURE=auth-required
// Leaderboard-refresh cron endpoint. Shared-secret authenticated; never
// cached. Triggered every 30 min by an external scheduler — fetches
// upstream prices, re-aggregates swaps, and writes the leaderboard
// snapshot to KV. The leaderboard read route (/api/leaderboard/score)
// reads from this snapshot only — no upstream fetches on the request path.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  buildLeaderboardSnapshot,
  writeLeaderboardSnapshot,
  LEADERBOARD_REFRESH_INTERVAL_SECONDS,
  LEADERBOARD_SNAPSHOT_TTL_SECONDS,
} from "@/lib/competition/leaderboard";

export async function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/leaderboard/refresh",
      methods: ["POST"],
      description:
        "Rebuilds the trading-comp leaderboard snapshot. Refreshes Tenero OHLC histories for every priceable token over the comp's burn_block_time window, reads every success swap from D1, aggregates per-agent P/L using historical price-at-burn_block_time, and writes the snapshot to KV. The read route /api/leaderboard/score serves from this snapshot — no upstream fetches on the request path. Also fires automatically via the Worker's scheduled() handler (wrangler triggers.crons).",
      auth: {
        scheme: "Shared secret",
        header: "X-Cron-Secret: {env.CRON_SECRET}",
      },
      recommendedCadenceSeconds: LEADERBOARD_REFRESH_INTERVAL_SECONDS,
      snapshotTtlSeconds: LEADERBOARD_SNAPSHOT_TTL_SECONDS,
      response: {
        rows: "LeaderboardRow[] — ranked per-agent rows",
        cachedAt: "string (ISO-8601)",
        stats: {
          total_swaps: "number",
          total_agents: "number",
          priced_swap_count: "number",
          unpriced_swap_count: "number",
          price_window_from: "number (unix seconds — earliest bucket fetched)",
          price_window_to: "number (unix seconds — latest bucket fetched)",
          refresh: {
            scanned: "number (tokens attempted)",
            priced: "number (tokens that returned at least one OHLC candle)",
            unpriced: "number (tokens with no candles in the window)",
            errors: "number (refresh threw)",
          },
        },
      },
      notes: [
        `Recommended cadence: every ${LEADERBOARD_REFRESH_INTERVAL_SECONDS / 60} min. The snapshot KV TTL is ${LEADERBOARD_SNAPSHOT_TTL_SECONDS / 60} min so up to 4 consecutive cron failures can pass before the snapshot disappears.`,
        "Tokens are sourced from TOKEN_DECIMALS (lib/competition/decimals.ts). Add tokens there to opt them into pricing.",
        "P/L is HISTORICAL (price at burn_block_time, fetched from Tenero OHLC at 1h period). Trades with missing OHLC candles on either leg are counted in trade_count but excluded from pnl_usd.",
        "Cron is wired via wrangler triggers.crons + worker.ts scheduled() — this HTTP route remains as a manual trigger for ad-hoc rebuilds.",
      ],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const expectedSecret = env.CRON_SECRET;
  if (!expectedSecret) {
    logger.error("CRON_SECRET not configured");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expectedSecret) {
    return NextResponse.json(
      { error: "Invalid or missing X-Cron-Secret" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/leaderboard/refresh");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 60,
      },
      {
        status: 503,
        headers: { "Retry-After": "60", "Cache-Control": "no-store" },
      }
    );
  }

  try {
    const snapshot = await buildLeaderboardSnapshot(
      { DB: db, VERIFIED_AGENTS: env.VERIFIED_AGENTS },
      logger
    );
    await writeLeaderboardSnapshot(env.VERIFIED_AGENTS, snapshot, logger);

    // Trim the rows payload from the response so the cron caller sees the
    // outcome stats without re-downloading the full snapshot. The rows are
    // available via GET /api/leaderboard/score.
    return NextResponse.json(
      {
        ok: true,
        cachedAt: snapshot.cachedAt,
        stats: snapshot.stats,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("competition.leaderboard.refresh_failed", {
      error: String(err),
    });
    return NextResponse.json(
      {
        error: "refresh_failed",
        message: "Leaderboard refresh failed. Existing snapshot (if any) is unchanged.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
