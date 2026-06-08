import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LeaderboardClient, { type LeaderboardRow } from "./LeaderboardClient";
import CompetitionCountdown from "./CompetitionCountdown";
import { COMP_START_TIMESTAMP } from "@/lib/competition/constants";
import { LEADERBOARD_AGGREGATE_SQL } from "@/lib/competition/leaderboard-query";
import { getEarningsLeaderboard, type EarningsLeaderboardRow } from "@/lib/earnings/reads";

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
const LEADERBOARD_CACHE_TTL_SECONDS = 300;

/**
 * Cache key for the leaderboard SSR data. Synthetic `cache.aibtc.local`
 * host (matches the pattern in `lib/edge-cache.ts`) keeps these entries
 * out of the live domain's HTTP cache namespace. Global key (no
 * per-request variation) — the leaderboard is a public ranking and the
 * SSR payload is identical for all visitors. Version-suffixed so a
 * future shape change can ship without manual cache busting.
 */
// v2: rows now carry earnings30dUsd / uniquePayers30d (issue #978). Bumping the
// key retires v1-shape cached payloads instead of serving them without earnings.
const LEADERBOARD_CACHE_URL = "https://cache.aibtc.local/leaderboard/ssr:v2";

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
 * The expensive rebuild path — exists separately from `fetchLeaderboard`
 * so the singleflight gate can wrap it cleanly. Caches both populated
 * results and the legitimate empty case so an early-competition empty
 * leaderboard doesn't run the full scan on every visit (Copilot PR #891
 * feedback). Returns `[]` when DB binding is missing (local dev).
 */
// The earnings overlay changes slowly and its GROUP BY is the cost-relevant
// scan, so it gets its OWN 1h cache — decoupled from the 5-min swap rebuild, so
// it runs ~24×/day/colo instead of riding the swap cache's 288×/day cadence.
const EARNINGS_OVERLAY_CACHE_URL =
  "https://cache.aibtc.local/leaderboard/earnings-30d:v1";
const EARNINGS_OVERLAY_TTL_SECONDS = 3600;
const inFlightEarnings = new Map<string, Promise<EarningsLeaderboardRow[]>>();

async function getCachedEarnings(
  db: D1Database,
  cache: Cache | null,
  ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined
): Promise<EarningsLeaderboardRow[]> {
  if (cache) {
    const hit = await cache.match(new Request(EARNINGS_OVERLAY_CACHE_URL, { method: "GET" }));
    if (hit) return (await hit.json()) as EarningsLeaderboardRow[];
  }
  const existing = inFlightEarnings.get(EARNINGS_OVERLAY_CACHE_URL);
  if (existing) return existing;

  const build = (async (): Promise<EarningsLeaderboardRow[]> => {
    try {
      const earners = await getEarningsLeaderboard(db, "30d", 500, 0, Date.now());
      console.log("leaderboard.earnings_overlay_rebuild", { earnerCount: earners.length });
      if (cache) {
        const resp = new Response(JSON.stringify(earners), {
          headers: {
            "Cache-Control": `public, max-age=${EARNINGS_OVERLAY_TTL_SECONDS}, s-maxage=${EARNINGS_OVERLAY_TTL_SECONDS}`,
            "Content-Type": "application/json",
          },
        });
        const put = cache.put(new Request(EARNINGS_OVERLAY_CACHE_URL, { method: "GET" }), resp);
        if (ctx?.waitUntil) ctx.waitUntil(put);
        else await put;
      }
      return earners;
    } finally {
      inFlightEarnings.delete(EARNINGS_OVERLAY_CACHE_URL);
    }
  })();
  inFlightEarnings.set(EARNINGS_OVERLAY_CACHE_URL, build);
  return build;
}

async function rebuildLeaderboard(
  db: D1Database | undefined,
  cache: Cache | null,
  ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined
): Promise<LeaderboardRow[]> {
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
  const rowByStx = new Map<string, LeaderboardRow>();
  for (const [sender, agg] of bySender.entries()) {
    rowByStx.set(sender, {
      stxAddress: sender,
      btcAddress: agg.display.btcAddress,
      displayName: agg.display.displayName,
      bnsName: agg.display.bnsName,
      erc8004AgentId: agg.display.erc8004AgentId,
      earnings30dUsd: 0,
      uniquePayers30d: 0,
      tradeCount: agg.count,
      latestTradeAt: agg.latestAt,
      tokensSpent: Array.from(agg.spent.entries()).map(([tokenId, sumAmount]) => ({
        tokenId,
        sumAmount,
      })),
      tokensReceived: Array.from(agg.received.entries()).map(
        ([tokenId, sumAmount]) => ({ tokenId, sumAmount })
      ),
    });
  }

  // Merge verified 30d earnings (top earners + metadata, index-served partial
  // index, behind this 5-min cache). Overlay onto swap rows; add earnings-only
  // agents (earned but haven't traded) so the board ranks all earners. Earnings
  // unavailable (cold start / D1 hiccup) → the board still renders trade rows.
  try {
    const earners = await getCachedEarnings(db, cache, ctx);
    for (const e of earners) {
      const existing = rowByStx.get(e.stx_address);
      if (existing) {
        existing.earnings30dUsd = e.earnings_usd;
        existing.uniquePayers30d = e.unique_payers;
      } else {
        rowByStx.set(e.stx_address, {
          stxAddress: e.stx_address,
          btcAddress: e.btc_address,
          displayName: e.display_name,
          bnsName: e.bns_name,
          erc8004AgentId: null,
          earnings30dUsd: e.earnings_usd,
          uniquePayers30d: e.unique_payers,
          tradeCount: 0,
          latestTradeAt: e.latest_at ?? 0,
          tokensSpent: [],
          tokensReceived: [],
        });
      }
    }
  } catch {
    // Earnings read failed — leave swap rows with 0 earnings; board still works.
  }

  const ranked: LeaderboardRow[] = Array.from(rowByStx.values()).sort((a, b) => {
    // Primary: earnings desc (the default metric, #978). Tiebreaks: trades, latest.
    if (b.earnings30dUsd !== a.earnings30dUsd) return b.earnings30dUsd - a.earnings30dUsd;
    if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
    return b.latestTradeAt - a.latestTradeAt;
  });

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
