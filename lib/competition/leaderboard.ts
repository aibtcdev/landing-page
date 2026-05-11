/**
 * Trading-comp leaderboard snapshot — builder + KV read/write surface.
 *
 * Cron-driven snapshot model (every 30 min):
 *   1. Cron route /api/competition/leaderboard/refresh fires (or the
 *      Worker's scheduled() handler).
 *   2. SELECT every success swap from D1 + JOIN agents for display names.
 *   3. Determine [fromTs, toTs] = [earliest burn_block_time, now] and
 *      refresh Tenero OHLC histories for every token in REFRESHABLE_ASSET_IDS
 *      that overlaps with the window.
 *   4. Aggregate to per-agent rows using historical price-at-burn_block_time
 *      lookups: trade_count + USD volume + true historical P/L.
 *   5. Sort by pnl_usd desc → trade_count desc → first_trade_at asc.
 *   6. Write the snapshot to `cache:leaderboard:score`.
 *
 * Read path (/api/leaderboard/score):
 *   - 1 KV read for the snapshot. Returns whatever the last cron wrote.
 *   - Empty snapshot (cron hasn't run yet OR returned 0 rows) → `{ rows: [], cachedAt: null }`.
 *   - UI shows the snapshot's `cachedAt` prominently so users know freshness.
 *
 * Why snapshot vs. per-request compute:
 *   - Predictable read latency (no D1 aggregation per request).
 *   - Predictable Tenero OHLC cost (2 cron ticks/hour × ~N tokens, not
 *     request-scaled).
 *   - Same pattern @whoabuddy approved on PR #651's portfolio snapshot.
 */

import type { Logger } from "@/lib/logging";
import {
  listSuccessSwapsWithAgentFromD1,
  type SwapWithAgent,
} from "./d1-reads";
import {
  refreshAllHistories,
  getCachedHistories,
  type RefreshSummary,
} from "./prices";
import { aggregateLeaderboard } from "./pnl";

/**
 * KV key for the persisted leaderboard snapshot.
 *
 * The `:v1` suffix is a schema version, not a release tag — bump it
 * (`:v2`, etc.) on any breaking change to `LeaderboardSnapshot`'s shape.
 * Stale-version reads return null naturally (JSON parse still works but
 * the snapshot is from a different key), so the UI degrades to the
 * empty-snapshot fallback until the cron re-fills the new key.
 *
 * Why this matters: preview and production share this KV namespace (per
 * wrangler.jsonc) so a preview cron running ahead-of-version code would
 * otherwise be able to write a malformed snapshot into the slot that
 * production reads. Per @arc0btc review on PR #742.
 */
export const LEADERBOARD_SNAPSHOT_KEY = "cache:leaderboard:score:v1";

/**
 * KV TTL for the snapshot. 2 hours = 4 cron ticks of slack. After 4
 * consecutive failed cron runs the snapshot disappears and reads return
 * `{ rows: [], cachedAt: null }` so the UI can show an explicit
 * "leaderboard temporarily unavailable" state instead of a stale snapshot
 * pretending to be current.
 */
export const LEADERBOARD_SNAPSHOT_TTL_SECONDS = 2 * 60 * 60;

/**
 * Recommended cadence for the leaderboard cron, in seconds. UI references
 * this for the "Refreshes every 30 min" caption so docs and behaviour stay
 * in sync.
 */
export const LEADERBOARD_REFRESH_INTERVAL_SECONDS = 30 * 60;

/**
 * Fallback `fromTs` for the OHLC fetch window when there are no swaps
 * yet (or the earliest swap is impossibly recent). 30 days back at 1h
 * candles = 720 candles — comfortably under Tenero's 1000-candle limit.
 */
export const PRICE_HISTORY_DEFAULT_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;

/**
 * Per-agent row that goes into the snapshot. Mirrors pnl.ts's
 * AgentScoreRow plus the JOINed display fields so the UI doesn't need a
 * follow-up agent-lookup per row.
 */
export interface LeaderboardRow {
  rank: number;
  stx_address: string;
  btc_address: string | null;
  display_name: string | null;
  bns_name: string | null;
  erc8004_agent_id: number | null;
  trade_count: number;
  priced_trade_count: number;
  unpriced_trade_count: number;
  volume_in_usd: number;
  volume_out_usd: number;
  pnl_usd: number;
  first_trade_at: number;
  last_trade_at: number;
}

export interface LeaderboardSnapshot {
  rows: LeaderboardRow[];
  /** ISO-8601 timestamp the snapshot was built. UI surfaces this directly. */
  cachedAt: string;
  /** Snapshot generation metadata — count of swaps walked, prices fetched, etc. */
  stats: {
    total_swaps: number;
    total_agents: number;
    priced_swap_count: number;
    unpriced_swap_count: number;
    /** Window the OHLC fetch covered, as unix-seconds. */
    price_window_from: number;
    price_window_to: number;
    refresh: RefreshSummary;
  };
}

/**
 * Build the leaderboard snapshot. Called by the cron path — fetches
 * everything needed (swaps + per-token OHLC histories), aggregates with
 * historical-price-at-burn_block_time, and produces a ready-to-serve
 * snapshot.
 *
 * Does NOT write to KV — callers (the cron path) are responsible for the
 * write so this function stays pure-ish (only reads + computes).
 */
export async function buildLeaderboardSnapshot(
  env: { DB: D1Database; VERIFIED_AGENTS: KVNamespace },
  logger?: Logger
): Promise<LeaderboardSnapshot> {
  // 1. Pull every success swap + agent display columns from D1.
  const swaps: SwapWithAgent[] = await listSuccessSwapsWithAgentFromD1(env.DB);

  // 2. Compute the OHLC fetch window. Earliest swap → now, with a
  //    floor of "last 30 days" so the first refresh after deploy still
  //    has data even when D1 is empty.
  //
  //    We use reduce rather than Math.min(...swaps.map(...)) — spreading a
  //    large array into Math.min puts every element on the call stack, and
  //    V8 (CF Workers runtime) throws RangeError around ~10k elements.
  //    The cron reads every success swap with no LIMIT (full-history
  //    aggregation), so this matters once the comp has meaningful volume.
  const nowTs = Math.floor(Date.now() / 1000);
  const earliestSwapTs =
    swaps.length > 0
      ? swaps.reduce(
          (min, s) => Math.min(min, s.burn_block_time),
          swaps[0].burn_block_time
        )
      : nowTs - PRICE_HISTORY_DEFAULT_LOOKBACK_SECONDS;
  const fromTs = Math.min(earliestSwapTs, nowTs - PRICE_HISTORY_DEFAULT_LOOKBACK_SECONDS);

  // 3. Refresh price histories (cron path: hits Tenero OHLC, writes KV).
  const refresh = await refreshAllHistories(env.VERIFIED_AGENTS, fromTs, nowTs, logger);

  // 4. Read the refreshed histories back for every distinct token that
  //    appears in the swaps. We refresh ALL tokens in REFRESHABLE_ASSET_IDS
  //    (above) so this read is just picking up what's relevant.
  const tokenIds = new Set<string>();
  for (const s of swaps) {
    tokenIds.add(s.token_in);
    tokenIds.add(s.token_out);
  }
  const histories = await getCachedHistories(
    env.VERIFIED_AGENTS,
    Array.from(tokenIds),
    logger
  );

  // 5. Aggregate by sender + sort. `swaps` are SwapWithAgent[] from the
  //    D1 JOIN, so the aggregator carries display fields onto each output
  //    row in its single swap walk — no second-pass stitch needed.
  const agentRows = aggregateLeaderboard(swaps, histories);

  const rows: LeaderboardRow[] = agentRows.map((a, i) => ({
    rank: i + 1,
    stx_address: a.sender,
    btc_address: a.btc_address,
    display_name: a.display_name,
    bns_name: a.bns_name,
    erc8004_agent_id: a.erc8004_agent_id,
    trade_count: a.trade_count,
    priced_trade_count: a.priced_trade_count,
    unpriced_trade_count: a.unpriced_trade_count,
    volume_in_usd: a.volume_in_usd,
    volume_out_usd: a.volume_out_usd,
    pnl_usd: a.pnl_usd,
    first_trade_at: a.first_trade_at,
    last_trade_at: a.last_trade_at,
  }));

  const pricedCount = rows.reduce((s, r) => s + r.priced_trade_count, 0);
  const unpricedCount = rows.reduce((s, r) => s + r.unpriced_trade_count, 0);

  return {
    rows,
    cachedAt: new Date().toISOString(),
    stats: {
      total_swaps: swaps.length,
      total_agents: rows.length,
      priced_swap_count: pricedCount,
      unpriced_swap_count: unpricedCount,
      price_window_from: fromTs,
      price_window_to: nowTs,
      refresh,
    },
  };
}

/** Persist a freshly built snapshot. */
export async function writeLeaderboardSnapshot(
  kv: KVNamespace,
  snapshot: LeaderboardSnapshot,
  logger?: Logger
): Promise<void> {
  try {
    await kv.put(LEADERBOARD_SNAPSHOT_KEY, JSON.stringify(snapshot), {
      expirationTtl: LEADERBOARD_SNAPSHOT_TTL_SECONDS,
    });
  } catch (err) {
    logger?.warn?.("competition.leaderboard.snapshot_write_failed", {
      error: String(err),
    });
    throw err;
  }
}

/**
 * Read the persisted snapshot. Returns null when no snapshot exists yet
 * (cron hasn't run; deploy fresh; or 4 consecutive cron failures hit the
 * TTL). The read route translates null into an empty `{ rows: [], cachedAt: null }`
 * shape so callers always get a well-formed response.
 */
export async function readLeaderboardSnapshot(
  kv: KVNamespace,
  logger?: Logger
): Promise<LeaderboardSnapshot | null> {
  try {
    const raw = await kv.get(LEADERBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LeaderboardSnapshot;
  } catch (err) {
    logger?.warn?.("competition.leaderboard.snapshot_read_failed", {
      error: String(err),
    });
    return null;
  }
}
