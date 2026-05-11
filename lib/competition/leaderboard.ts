/**
 * Trading-comp leaderboard snapshot — builder + KV read/write surface.
 *
 * Cron-driven snapshot model (every 30 min):
 *   1. Cron route /api/competition/leaderboard/refresh fires.
 *   2. Refresh prices for every token in TOKEN_DECIMALS (Tenero + CoinGecko).
 *   3. SELECT every success swap from D1 + JOIN agents for display names.
 *   4. Aggregate to per-agent rows: trade_count + USD volume + P/L.
 *   5. Sort by pnl_usd desc → trade_count desc → first_trade_at asc.
 *   6. Write the snapshot to `cache:leaderboard:score`.
 *
 * Read path (/api/leaderboard/score):
 *   - 1 KV read for the snapshot. Returns whatever the last cron wrote.
 *   - Empty snapshot (cron hasn't run yet OR returned 0 rows) → `{ rows: [], cachedAt: null }`.
 *   - UI shows the snapshot's `cachedAt` prominently so users know the freshness.
 *
 * Why snapshot vs. per-request compute:
 *   - Predictable read latency (no D1 aggregation per request).
 *   - Predictable Tenero/CoinGecko cost (12 cron ticks/hour × ~10 tokens, not request-scaled).
 *   - Same pattern @whoabuddy approved on PR #651's portfolio snapshot.
 */

import type { Logger } from "@/lib/logging";
import {
  listSuccessSwapsWithAgentFromD1,
  type SwapWithAgent,
} from "./d1-reads";
import {
  refreshAllPrices,
  getCachedTokenPricesUsd,
  type RefreshSummary,
} from "./prices";
import { aggregateLeaderboard } from "./pnl";

/** KV key for the persisted leaderboard snapshot. */
export const LEADERBOARD_SNAPSHOT_KEY = "cache:leaderboard:score";

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
    refresh: RefreshSummary;
  };
}

/**
 * Build the leaderboard snapshot. Called by the cron route — fetches
 * everything needed (prices + swaps), aggregates, and produces a
 * ready-to-serve snapshot.
 *
 * Does NOT write to KV — callers (the cron route) are responsible for the
 * write so this function stays pure-ish (only reads + computes).
 */
export async function buildLeaderboardSnapshot(
  env: { DB: D1Database; VERIFIED_AGENTS: KVNamespace },
  logger?: Logger
): Promise<LeaderboardSnapshot> {
  // 1. Refresh prices (cron path: hits Tenero + CoinGecko, writes KV).
  //    This happens BEFORE the swap read so by the time we aggregate, the
  //    cached prices are fresh.
  const refresh = await refreshAllPrices(env.VERIFIED_AGENTS, logger);

  // 2. Pull every success swap + agent display columns from D1.
  const swaps: SwapWithAgent[] = await listSuccessSwapsWithAgentFromD1(env.DB);

  // 3. Collect every distinct token id and read its (just-refreshed) price.
  const tokenIds = new Set<string>();
  for (const s of swaps) {
    tokenIds.add(s.token_in);
    tokenIds.add(s.token_out);
  }
  const prices = await getCachedTokenPricesUsd(
    env.VERIFIED_AGENTS,
    Array.from(tokenIds),
    logger
  );

  // 4. Aggregate by sender + sort.
  const agentRows = aggregateLeaderboard(swaps, prices);

  // 5. Stitch display columns from the JOINed swap rows back onto the
  //    per-sender aggregate. Each sender appears multiple times in `swaps`
  //    but the display fields are agent-scoped, so the first hit per
  //    sender is canonical.
  const displayBySender = new Map<
    string,
    {
      btc_address: string | null;
      display_name: string | null;
      bns_name: string | null;
      erc8004_agent_id: number | null;
    }
  >();
  for (const s of swaps) {
    if (!displayBySender.has(s.sender)) {
      displayBySender.set(s.sender, {
        btc_address: s.btc_address,
        display_name: s.display_name,
        bns_name: s.bns_name,
        erc8004_agent_id: s.erc8004_agent_id,
      });
    }
  }

  const rows: LeaderboardRow[] = agentRows.map((a, i) => {
    const display = displayBySender.get(a.sender) ?? {
      btc_address: null,
      display_name: null,
      bns_name: null,
      erc8004_agent_id: null,
    };
    return {
      rank: i + 1,
      stx_address: a.sender,
      btc_address: display.btc_address,
      display_name: display.display_name,
      bns_name: display.bns_name,
      erc8004_agent_id: display.erc8004_agent_id,
      trade_count: a.trade_count,
      priced_trade_count: a.priced_trade_count,
      unpriced_trade_count: a.unpriced_trade_count,
      volume_in_usd: a.volume_in_usd,
      volume_out_usd: a.volume_out_usd,
      pnl_usd: a.pnl_usd,
      first_trade_at: a.first_trade_at,
      last_trade_at: a.last_trade_at,
    };
  });

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
