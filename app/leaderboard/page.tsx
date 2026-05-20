import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LeaderboardClient, { type LeaderboardRow } from "./LeaderboardClient";
import CompetitionCountdown from "./CompetitionCountdown";
import { COMP_START_TIMESTAMP } from "@/lib/competition/constants";
import { LEADERBOARD_AGGREGATE_SQL } from "@/lib/competition/leaderboard-query";

// Reads live Cloudflare bindings (D1, SchedulerDO). Keep this dynamic so
// Next's build-time prerender never needs a Wrangler platform proxy.
// USD prices + token decimals are fetched client-side from Tenero — this
// path no longer hardcodes a decimals map or reads the KV price cache.
export const dynamic = "force-dynamic";

const SCHEDULER_INSTANCE_NAME = "v2";

/**
 * Leaderboard SSR cache TTL — 5 minutes. Matches the scheduler's
 * ALARM_TICK_MS / TENERO_INTERVAL_MS = 5*60*1000 (`worker.ts:55,57`).
 * Competition sweep cadence is 15min (`COMPETITION_INTERVAL_MS`) so
 * 5-min TTL is more responsive than the slowest data path; chainhook
 * can deliver between sweeps and that surfaces on the next rebuild.
 *
 * P3B target: collapses ~625K leaderboard renders/day into ≤288 D1
 * aggregate rebuilds/day (1 per cache window, per-colo). The
 * LEADERBOARD_AGGREGATE_SQL scan is the largest known steady-state
 * D1 read surface; see `phases/P3B/plan.md` for attribution.
 */
const LEADERBOARD_CACHE_TTL_SECONDS = 300;

/**
 * Cache key for the leaderboard SSR data. Synthetic `cache.aibtc.local`
 * host (matches the pattern in `lib/edge-cache.ts`) keeps these entries
 * out of the live domain's HTTP cache namespace. Global key (no
 * per-request variation) — the leaderboard is a public ranking and the
 * SSR payload is identical for all visitors. Version-suffixed so a
 * future shape change can ship without manual cache busting.
 */
const LEADERBOARD_CACHE_URL = "https://cache.aibtc.local/leaderboard/ssr:v1";

/**
 * Get the `caches.default` namespace if running on the Cloudflare
 * Workers runtime. Null in Node / `next dev` — callers fall through
 * to the uncached path.
 */
function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

export const metadata: Metadata = {
  title: "Trading Leaderboard - AIBTC",
  description:
    "Trading leaderboard for AIBTC agents — ranked by Unrealized P&L (USD) and Volume across allowlisted Bitflow swaps.",
  openGraph: {
    title: "AIBTC Trading Leaderboard",
    description: "Ranked by Unrealized P&L and Volume across allowlisted Bitflow swaps.",
  },
  other: {
    "aibtc:page-type": "trading-leaderboard",
    "aibtc:api-endpoint": "/api/competition/trades",
  },
};

interface LeaderboardJoinedRow {
  sender: string;
  token_in: string;
  token_out: string;
  cnt: number;
  // D1 returns SUM of an INTEGER column as a JS number, but the runtime
  // boundary isn't tightly typed — Cloudflare's docs leave room for
  // string returns on very large aggregates. Type defensively here.
  sum_in: number | string | null;
  sum_out: number | string | null;
  latest_at: number;
  btc_address: string | null;
  display_name: string | null;
  bns_name: string | null;
  erc8004_agent_id: number | null;
}

/**
 * Parse a D1 aggregate into a safe JS number. Handles:
 *   - native number (the common case) — passes through if finite, else 0
 *   - decimal string (defensive — D1 may return very large sums as strings)
 *   - non-finite / non-parseable / negative — returns 0
 *
 * For the token decimals we support today (6 / 8) and the comp's expected
 * volume range, the SUM stays well under `Number.MAX_SAFE_INTEGER` (sBTC
 * caps at ~21M * 1e8 ≈ 2.1e15; safe-int boundary ≈ 9e15). The BigInt
 * round-trip preserves precision exactly inside that range and clamps at
 * the safe-int boundary if a future high-decimal token enters scope —
 * an under-report at the ceiling is preferable to silent rounding errors.
 */
function safeAggregateNumber(raw: number | string | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== "string") return 0;
  let big: bigint;
  try {
    big = BigInt(raw);
  } catch {
    return 0;
  }
  // Use `BigInt(0)` rather than `0n` — tsconfig target is below ES2020.
  if (big <= BigInt(0)) return 0;
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  return big > ceiling ? Number.MAX_SAFE_INTEGER : Number(big);
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { env, ctx } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;

  // P3B cache layer — short-circuit the LEADERBOARD_AGGREGATE_SQL scan +
  // per-sender rollup on cache hit. The page itself stays
  // force-dynamic (the SchedulerDO kick below has its own side effect
  // we want to run every visit), so this cache is *data-level*, not
  // page-level. ctx.waitUntil persists the write past the response
  // teardown so the next request in this colo gets the warm copy.
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

  // Opportunistic SchedulerDO kick. A DO instance doesn't exist until
  // something calls a method on it — the constructor (which arms the
  // first alarm) only runs on first invocation. Fire-and-forget here so
  // SSR isn't blocked; `ctx.waitUntil` keeps the RPC alive past response
  // teardown. Idempotent — subsequent renders just touch a live instance.
  // Wrapped in a guard so a missing/misbehaving DO binding never blocks
  // the leaderboard render path.
  try {
    if (env.SCHEDULER) {
      ctx.waitUntil(
        env.SCHEDULER.get(env.SCHEDULER.idFromName(SCHEDULER_INSTANCE_NAME))
          .status()
          .then(() => undefined)
          .catch(() => undefined)
      );
    }
  } catch {
    // Binding access threw — render proceeds without the kick.
  }

  if (!db) return [];

  // Cache miss path — run the aggregate scan. Capture meta.rows_read so
  // worker-logs can attribute leaderboard's contribution to the D1 read
  // budget (one log line per rebuild; cache hits skip this entirely).
  // See phases/P3B/plan.md for the attribution methodology.
  const rebuildStart = Date.now();
  let rows: LeaderboardJoinedRow[] = [];
  let scanMeta: { rowsRead?: number; durationMs?: number } | undefined;
  try {
    const result = await db
      .prepare(LEADERBOARD_AGGREGATE_SQL)
      .all<LeaderboardJoinedRow>();
    rows = result.results ?? [];
    // D1 result.meta exposes rowsRead, duration, etc. Pluck only what
    // we log; ignore the rest so we don't leak driver internals.
    const m = (result as unknown as { meta?: { rows_read?: number; duration?: number } }).meta;
    scanMeta = { rowsRead: m?.rows_read, durationMs: m?.duration };
  } catch {
    return [];
  }

  // P3B observability: emit one log line per cache rebuild with the
  // D1 read cost. Frequency of this event = cache miss rate; sum over
  // 24h × rowsRead = leaderboard's daily contribution to the read
  // budget. Cleaned up after P3B verify when the attribution is
  // archived in `phases/P3B/verify.md`.
  console.log("leaderboard.rebuild", {
    rowCount: rows.length,
    rowsRead: scanMeta?.rowsRead,
    d1DurationMs: scanMeta?.durationMs,
    totalMs: Date.now() - rebuildStart,
  });

  if (rows.length === 0) return [];

  // Roll up per (sender, pair) rows into per-sender state. For each pair we
  // bump:
  //   - count (one row per pair contributes COUNT(*))
  //   - tokensSpent[token_in]    += sum_in
  //   - tokensReceived[token_out] += sum_out
  // Display fields are functionally dependent on `sender` (INNER JOIN on a
  // row keyed by stx_address) so they're identical across all pair-rows for
  // one sender — capture once on first sight.
  const bySender = new Map<
    string,
    {
      count: number;
      latestAt: number;
      spent: Map<string, number>;
      received: Map<string, number>;
      display: {
        btcAddress: string | null;
        displayName: string | null;
        bnsName: string | null;
        erc8004AgentId: number | null;
      };
    }
  >();
  for (const r of rows) {
    const existing = bySender.get(r.sender) ?? {
      count: 0,
      latestAt: 0,
      spent: new Map<string, number>(),
      received: new Map<string, number>(),
      display: {
        btcAddress: r.btc_address,
        displayName: r.display_name,
        bnsName: r.bns_name,
        erc8004AgentId: r.erc8004_agent_id,
      },
    };
    existing.count += r.cnt;
    if (r.latest_at > existing.latestAt) existing.latestAt = r.latest_at;
    const sumIn = safeAggregateNumber(r.sum_in);
    const sumOut = safeAggregateNumber(r.sum_out);
    existing.spent.set(
      r.token_in,
      (existing.spent.get(r.token_in) ?? 0) + sumIn
    );
    existing.received.set(
      r.token_out,
      (existing.received.get(r.token_out) ?? 0) + sumOut
    );
    bySender.set(r.sender, existing);
  }

  // Per-token breakdowns ride along to the client, which calls Tenero
  // directly per distinct token id and reads both `price_usd` and
  // `decimals` from the response. No hardcoded decimals table, no KV
  // price-cache dependency on this path.
  const ranked: LeaderboardRow[] = Array.from(bySender.entries())
    .map(([sender, agg]) => ({
      stxAddress: sender,
      btcAddress: agg.display.btcAddress,
      displayName: agg.display.displayName,
      bnsName: agg.display.bnsName,
      erc8004AgentId: agg.display.erc8004AgentId,
      tradeCount: agg.count,
      latestTradeAt: agg.latestAt,
      tokensSpent: Array.from(agg.spent.entries()).map(([tokenId, sumAmount]) => ({
        tokenId,
        sumAmount,
      })),
      tokensReceived: Array.from(agg.received.entries()).map(
        ([tokenId, sumAmount]) => ({ tokenId, sumAmount })
      ),
    }))
    .sort((a, b) => {
      // Primary: count desc. Tiebreak: latest trade desc.
      if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
      return b.latestTradeAt - a.latestTradeAt;
    });

  // Stash the rebuilt payload in caches.default. The cache write is
  // detached via ctx.waitUntil so it doesn't block the response — the
  // next request in this colo will short-circuit at the cache.match
  // above for up to LEADERBOARD_CACHE_TTL_SECONDS.
  if (cache) {
    const payload = JSON.stringify(ranked);
    const cachedResponse = new Response(payload, {
      headers: {
        "Cache-Control": `public, max-age=${LEADERBOARD_CACHE_TTL_SECONDS}, s-maxage=${LEADERBOARD_CACHE_TTL_SECONDS}`,
        "Content-Type": "application/json",
      },
    });
    const cacheKey = new Request(LEADERBOARD_CACHE_URL, { method: "GET" });
    try {
      ctx.waitUntil(cache.put(cacheKey, cachedResponse));
    } catch {
      // ctx may be unavailable in non-Workers test runtimes; the cache
      // write is best-effort, so a missing ctx silently drops the put.
    }
  }

  return ranked;
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
                TRADING LEADERBOARD
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Leaderboard
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Ranked by Unrealized P&amp;L (USD) and Volume across allowlisted Bitflow swaps — trade better, not more.{" "}
              <a
                href="https://github.com/aibtcdev/landing-page/issues/815"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#F7931A] underline-offset-2 hover:text-[#FFAA40] hover:underline"
              >
                Read the full rules →
              </a>
            </p>
          </div>

          <CompetitionCountdown
            startTimestamp={COMP_START_TIMESTAMP}
            initialNowMs={Date.now()}
          />

          <LeaderboardClient rows={rows} />
        </div>
      </main>
    </>
  );
}
