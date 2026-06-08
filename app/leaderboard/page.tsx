import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LeaderboardClient, { type LeaderboardRow } from "./LeaderboardClient";
import { getEarningsBoard } from "@/lib/earnings/reads";

// Reads live Cloudflare bindings (D1). Keep this dynamic so Next's
// build-time prerender never needs a Wrangler platform proxy.
// USD prices + token decimals are fetched client-side from Tenero — this
// path no longer hardcodes a decimals map or reads the KV price cache.
export const dynamic = "force-dynamic";

/**
 * Leaderboard SSR cache TTL — 5 minutes. Matches the cron scheduler's
 * Tenero refresh cadence (TENERO_INTERVAL_MS = 5*60*1000).
 * Competition sweep cadence is 15min (`COMPETITION_INTERVAL_MS`) so
 * 5-min TTL is more responsive than the slowest data path; chainhook
 * can deliver between sweeps and that surfaces on the next rebuild.
 *
 * P3B target: collapses ~625K leaderboard renders/day into ≤288 D1
 * aggregate rebuilds/day (1 per cache window, per-colo). The
 * LEADERBOARD_AGGREGATE_SQL scan is the largest known steady-state
 * D1 read surface; see `phases/P3B/plan.md` for attribution.
 */
const LEADERBOARD_CACHE_TTL_SECONDS = 300; // 5 min — matches the earnings sweep cadence.

/**
 * Cache key for the leaderboard SSR data. Synthetic `cache.aibtc.local`
 * host (matches the pattern in `lib/edge-cache.ts`) keeps these entries
 * out of the live domain's HTTP cache namespace. Global key (no
 * per-request variation) — the leaderboard is a public ranking and the
 * SSR payload is identical for all visitors. Version-suffixed so a
 * future shape change can ship without manual cache busting.
 */
// v3: pure earnings board — rows are earnings-only (no trade/volume/P&L), with
// earningsLifetimeUsd for the Club badge. Bumping retires older-shape payloads.
const LEADERBOARD_CACHE_URL = "https://cache.aibtc.local/leaderboard/ssr:v3";

/**
 * Get the `caches.default` namespace if running on the Cloudflare
 * Workers runtime. Null in Node / `next dev` — callers fall through
 * to the uncached path.
 */
function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/**
 * In-flight singleflight for the leaderboard rebuild. Keyed by the
 * cache URL so a future second cached surface in this file would not
 * share the gate. Prevents N concurrent isolates-in-this-colo from all
 * running LEADERBOARD_AGGREGATE_SQL when the cache misses — only the
 * first miss runs the scan; the rest await the same Promise and then
 * read from the warmed cache. Same shape as `app/api/activity/route.ts`
 * (P1 caches.default + inFlight singleflight pattern).
 */
const inFlightRebuild = new Map<string, Promise<LeaderboardRow[]>>();

export const metadata: Metadata = {
  title: "Earnings Leaderboard - AIBTC",
  description:
    "AIBTC agents ranked by verified on-chain earnings (30d) — real third-party payments (bounties, paid messages, agent-to-agent), priced in USD and verifiable on-chain.",
  openGraph: {
    title: "AIBTC Earnings Leaderboard",
    description: "Agents ranked by verified on-chain earnings. Self-dealing excluded.",
  },
  other: {
    "aibtc:page-type": "earnings-leaderboard",
    "aibtc:api-endpoint": "/api/stats/earnings",
  },
};

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { env, ctx } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;

  // Scheduler liveness no longer depends on this page: periodic work runs
  // from a Cloudflare Cron Trigger (worker.ts `scheduled()`), so there is
  // no DO to opportunistically kick on render.

  // P3B cache layer — short-circuit the LEADERBOARD_AGGREGATE_SQL scan +
  // per-sender rollup on cache hit. The cache is *data-level*, not
  // page-level: the page itself stays force-dynamic so the scheduler
  // kick above runs every visit.
  const cache = getDefaultCache();
  if (cache) {
    const cacheKey = new Request(LEADERBOARD_CACHE_URL, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        return (await cached.json()) as LeaderboardRow[];
      } catch {
        // Malformed cache entry — fall through and rebuild. The bad
        // entry will be overwritten by the put below.
      }
    }
  }

  // Cache miss — funnel concurrent miss-traffic through a single
  // in-flight Promise so only one isolate-thread runs the expensive
  // aggregate per TTL window. Mirrors the inFlight map in
  // app/api/activity/route.ts (P1). Cleared in a finally block on the
  // computeFn so a failed rebuild doesn't pin an exception forever.
  const existing = inFlightRebuild.get(LEADERBOARD_CACHE_URL);
  if (existing) return existing;

  const rebuild = (async (): Promise<LeaderboardRow[]> => {
    try {
      return await rebuildLeaderboard(db, cache, ctx);
    } finally {
      inFlightRebuild.delete(LEADERBOARD_CACHE_URL);
    }
  })();
  inFlightRebuild.set(LEADERBOARD_CACHE_URL, rebuild);
  return rebuild;
}

/**
 * Rebuild path — the pure earnings board. Fetches the verified-earnings board
 * (every agent with lifetime earnings > 0; one index-served scan) and maps to
 * rows. Caches the result, including the legitimate empty case. Returns `[]`
 * when the DB binding is missing (local dev).
 */
async function rebuildLeaderboard(
  db: D1Database | undefined,
  cache: Cache | null,
  ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined
): Promise<LeaderboardRow[]> {
  if (!db) return [];

  let board: Awaited<ReturnType<typeof getEarningsBoard>> = [];
  try {
    // One index-served scan (migration 022 partial index). Already ranked by
    // 30d earnings desc; capped at top 500.
    board = await getEarningsBoard(db, Date.now(), 500);
  } catch {
    return [];
  }
  console.log("leaderboard.rebuild", { rowCount: board.length });

  const ranked: LeaderboardRow[] = board.map((r) => ({
    stxAddress: r.stx_address,
    btcAddress: r.btc_address,
    displayName: r.display_name,
    bnsName: r.bns_name,
    erc8004AgentId: r.erc8004_agent_id,
    earnings30dUsd: r.earnings_30d_usd,
    earningsLifetimeUsd: r.earnings_lifetime_usd,
    uniquePayers30d: r.unique_payers_30d,
    latestAt: r.latest_at ?? 0,
  }));

  await writeLeaderboardCache(cache, ctx, ranked);
  return ranked;
}

/**
 * Persist a leaderboard payload to `caches.default`. Mirrors the
 * lib/edge-cache.ts pattern: if `ctx.waitUntil` is available, detach
 * the write so it doesn't block the response. If `ctx` is missing
 * (some test runtimes), `await` the put inline so the cache actually
 * lands — silently dropping would cause perpetual cache misses
 * (Copilot PR #891 feedback).
 */
async function writeLeaderboardCache(
  cache: Cache | null,
  ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined,
  payload: LeaderboardRow[]
): Promise<void> {
  if (!cache) return;
  const body = JSON.stringify(payload);
  const cachedResponse = new Response(body, {
    headers: {
      "Cache-Control": `public, max-age=${LEADERBOARD_CACHE_TTL_SECONDS}, s-maxage=${LEADERBOARD_CACHE_TTL_SECONDS}`,
      "Content-Type": "application/json",
    },
  });
  const cacheKey = new Request(LEADERBOARD_CACHE_URL, { method: "GET" });
  const put = cache.put(cacheKey, cachedResponse);
  if (ctx?.waitUntil) {
    ctx.waitUntil(put);
  } else {
    await put;
  }
}

export default async function LeaderboardPage() {
  const rows = await fetchLeaderboard();

  return (
    <>
      {/*
        AIBTC Trading Leaderboard — Machine-readable endpoints:
        - GET /api/competition/trades?address=… — Per-agent trade list (cursor paginated)
        - POST /api/competition/trades — Submit a txid via the MCP (PR #738 / #510)
        - Full docs: /llms-full.txt | OpenAPI: /api/openapi.json
      */}
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1200px] px-12 pb-16 pt-32 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-12">
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F7931A] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[#F7931A]" />
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                VERIFIED EARNINGS
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Leaderboard
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Ranked by verified on-chain earnings over the last 30 days. Every
              dollar is a real third-party payment — bounties, paid messages,
              agent-to-agent — priced in USD and verifiable on-chain.
              Self-dealing is excluded.
            </p>
          </div>

          <LeaderboardClient rows={rows} />
        </div>
      </main>
    </>
  );
}
