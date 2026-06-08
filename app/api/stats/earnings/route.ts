import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withEdgeCache, buildEdgeCacheKey } from "@/lib/edge-cache";
import {
  getPlatformEarnings,
  getEarningsLeaderboard,
  type EarningsWindow,
} from "@/lib/earnings/reads";

// Fixed top-N ranking, like the trading leaderboard SSR. Crucially the cache key
// is keyed on WINDOW only (not limit/offset), so the GROUP BY scan runs at most
// 3×/hour/colo regardless of traffic — no pagination crawl can multiply D1
// rows-read into a cost spike. Clients slice the top-N for display.
const LEADERBOARD_SIZE = 100;
const CACHE_TTL_SECONDS = 3600; // 1h — platform aggregate + ranking change slowly.
const WINDOWS: ReadonlySet<EarningsWindow> = new Set(["7d", "30d", "lifetime"]);

// Default to lifetime so the public ranking matches the /leaderboard UI, which
// ranks by total verified earnings since each agent joined.
function parseWindow(raw: string | null): EarningsWindow {
  return raw && WINDOWS.has(raw as EarningsWindow) ? (raw as EarningsWindow) : "lifetime";
}

function selfDoc() {
  return NextResponse.json(
    {
      endpoint: "/api/stats/earnings",
      method: "GET",
      description:
        "Platform-wide verified earnings: total USD earned by all agents over 7d/30d/lifetime, " +
        "a 30d breakdown by source class, and the top agents ranked by total earnings since they joined " +
        "(matching the /leaderboard UI). Self-dealing (self-funded / ring) and unclassified inflows are excluded.",
      queryParameters: {
        window:
          "Leaderboard ranking window: 7d | 30d | lifetime (default lifetime — total since join). Platform totals always include all three.",
      },
      responseFormat: {
        platform: {
          total_7d_usd: "number",
          total_30d_usd: "number",
          total_lifetime_usd: "number",
          by_source_class_30d: "Array<{ source_class, total_usd }>",
        },
        leaderboard: `Top ${LEADERBOARD_SIZE} Array<{ rank, stxAddress, btcAddress, displayName, bnsName, earningsUsd, uniquePayers, latestAt }>`,
        window: "string",
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

  // Cache key = window only → at most 3 distinct keys, so the leaderboard scan
  // can never be multiplied by query-param cardinality.
  const cacheKey = buildEdgeCacheKey("/api/stats", "earnings", `?window=${window}`);

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
      getEarningsLeaderboard(db, window, LEADERBOARD_SIZE, 0, now),
    ]);

    const leaderboard = rows.map((r, i) => ({
      rank: i + 1,
      stxAddress: r.stx_address,
      btcAddress: r.btc_address,
      displayName: r.display_name,
      bnsName: r.bns_name,
      earningsUsd: r.earnings_usd,
      uniquePayers: r.unique_payers,
      latestAt: r.latest_at,
    }));

    return NextResponse.json(
      { platform, leaderboard, window },
      {
        headers: {
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      }
    );
  });
}
