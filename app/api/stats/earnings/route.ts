import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withEdgeCache, buildEdgeCacheKey } from "@/lib/edge-cache";
import {
  getPlatformEarnings,
  getEarningsLeaderboard,
  type EarningsWindow,
} from "@/lib/earnings/reads";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CACHE_TTL_SECONDS = 3600; // 1h — platform aggregate + ranking change slowly.
const WINDOWS: ReadonlySet<EarningsWindow> = new Set(["7d", "30d", "lifetime"]);

function parseWindow(raw: string | null): EarningsWindow {
  return raw && WINDOWS.has(raw as EarningsWindow) ? (raw as EarningsWindow) : "30d";
}

function selfDoc() {
  return NextResponse.json(
    {
      endpoint: "/api/stats/earnings",
      method: "GET",
      description:
        "Platform-wide verified earnings: total USD earned by all agents over 7d/30d/lifetime, " +
        "a 30d breakdown by source class, and the agent leaderboard ranked by earnings in the chosen window.",
      queryParameters: {
        window:
          "Leaderboard ranking window: 7d | 30d | lifetime (default 30d). Platform totals always include all three.",
        limit: `Leaderboard rows per page (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
        offset: "Leaderboard offset (default 0).",
      },
      responseFormat: {
        platform: {
          total_7d_usd: "number",
          total_30d_usd: "number",
          total_lifetime_usd: "number",
          by_source_class_30d: "Array<{ source_class, total_usd }>",
        },
        leaderboard:
          "Array<{ rank, stxAddress, btcAddress, displayName, bnsName, earningsUsd, uniquePayers, latestAt }>",
        window: "string",
        pagination: { limit: "number", offset: "number", hasMore: "boolean" },
      },
      relatedEndpoints: { perAgent: "/api/agents/{address}/earnings" },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("docs") === "1") return selfDoc();

  const window = parseWindow(url.searchParams.get("window"));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const cacheKey = buildEdgeCacheKey(
    "/api/stats",
    "earnings",
    `?window=${window}&limit=${limit}&offset=${offset}`
  );

  return withEdgeCache(cacheKey, CACHE_TTL_SECONDS, async () => {
    const { env } = await getCloudflareContext();
    const db = env.DB as D1Database | undefined;
    if (!db) {
      return NextResponse.json(
        { error: "Database unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const now = Date.now();
    const [platform, rows] = await Promise.all([
      getPlatformEarnings(db, now),
      getEarningsLeaderboard(db, window, limit + 1, offset, now),
    ]);

    const hasMore = rows.length > limit;
    const leaderboard = (hasMore ? rows.slice(0, limit) : rows).map((r, i) => ({
      rank: offset + i + 1,
      stxAddress: r.stx_address,
      btcAddress: r.btc_address,
      displayName: r.display_name,
      bnsName: r.bns_name,
      earningsUsd: r.earnings_usd,
      uniquePayers: r.unique_payers,
      latestAt: r.latest_at,
    }));

    return NextResponse.json(
      { platform, leaderboard, window, pagination: { limit, offset, hasMore } },
      {
        headers: {
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      }
    );
  });
}
