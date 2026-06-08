/**
 * Earnings read/aggregation helpers (issue #978, Phase 3).
 *
 * Read-time GROUP BY over the indexed ledger (only `is_earning = 1` rows),
 * windowed by block_time. Served by the partial index
 * `idx_agent_earnings_leaderboard (recipient_agent_stx, block_time) WHERE
 * is_earning = 1` (migration 022) — the leaderboard GROUP BY needs no transient
 * B-tree and per-agent rollups seek straight to the agent's earning rows. Routes
 * also wrap these in a 1h edge cache (see docs §6/§13). `amount_usd` may be NULL
 * for transfers indexed during a Tenero gap; SUM() ignores NULLs.
 */

import type { SourceClass } from "./types";

const DAY = 24 * 60 * 60;

export type EarningsWindow = "7d" | "30d" | "lifetime";

/** Window start as a unix-seconds bound (lifetime → 0). `now` is unix ms. */
export function windowStart(window: EarningsWindow, now: number): number {
  const nowSec = Math.floor(now / 1000);
  if (window === "7d") return nowSec - 7 * DAY;
  if (window === "30d") return nowSec - 30 * DAY;
  return 0;
}

export interface AgentEarningsRollup {
  earnings_7d_usd: number;
  earnings_30d_usd: number;
  earnings_lifetime_usd: number;
  unique_payers_30d: number;
  top_source_class_30d: SourceClass | null;
}

export async function getAgentRollup(
  db: D1Database,
  stxAddress: string,
  now: number
): Promise<AgentEarningsRollup> {
  const sevenAgo = windowStart("7d", now);
  const thirtyAgo = windowStart("30d", now);

  // Two independent reads over the same recipient partition — overlap them.
  const [totals, topSource] = await Promise.all([
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN block_time >= ?2 THEN amount_usd END), 0) AS e7,
           COALESCE(SUM(CASE WHEN block_time >= ?3 THEN amount_usd END), 0) AS e30,
           COALESCE(SUM(amount_usd), 0) AS elife,
           COUNT(DISTINCT CASE WHEN block_time >= ?3 THEN sender_stx END) AS payers30
         FROM agent_earnings
         WHERE recipient_agent_stx = ?1 AND is_earning = 1`
      )
      .bind(stxAddress, sevenAgo, thirtyAgo)
      .first<{ e7: number; e30: number; elife: number; payers30: number }>(),
    db
      .prepare(
        // Only priced rows: a class whose 30d total is $0 (unpriced gap) isn't a
        // meaningful "top earning source".
        `SELECT source_class FROM agent_earnings
         WHERE recipient_agent_stx = ?1 AND is_earning = 1 AND block_time >= ?2
           AND amount_usd IS NOT NULL
         GROUP BY source_class ORDER BY SUM(amount_usd) DESC LIMIT 1`
      )
      .bind(stxAddress, thirtyAgo)
      .first<{ source_class: SourceClass }>(),
  ]);

  return {
    earnings_7d_usd: totals?.e7 ?? 0,
    earnings_30d_usd: totals?.e30 ?? 0,
    earnings_lifetime_usd: totals?.elife ?? 0,
    unique_payers_30d: totals?.payers30 ?? 0,
    top_source_class_30d: topSource?.source_class ?? null,
  };
}

export interface EarningLineItem {
  tx_id: string;
  event_index: number;
  block_time: number;
  sender_stx: string;
  asset: string;
  amount_raw: number;
  amount_usd: number | null;
  source_class: SourceClass;
  source_subclass: string | null;
}

export async function getAgentLineItems(
  db: D1Database,
  stxAddress: string,
  limit: number,
  offset: number
): Promise<EarningLineItem[]> {
  const res = await db
    .prepare(
      `SELECT tx_id, event_index, block_time, sender_stx, asset, amount_raw,
              amount_usd, source_class, source_subclass
       FROM agent_earnings
       WHERE recipient_agent_stx = ?1 AND is_earning = 1
       ORDER BY block_time DESC, event_index DESC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(stxAddress, limit, offset)
    .all<EarningLineItem>();
  return res.results ?? [];
}

export interface SourceBreakdownEntry {
  source_class: SourceClass;
  total_usd: number;
}

export interface PlatformEarnings {
  total_7d_usd: number;
  total_30d_usd: number;
  total_lifetime_usd: number;
  by_source_class_30d: SourceBreakdownEntry[];
}

export async function getPlatformEarnings(
  db: D1Database,
  now: number
): Promise<PlatformEarnings> {
  const sevenAgo = windowStart("7d", now);
  const thirtyAgo = windowStart("30d", now);

  const totals = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN block_time >= ?1 THEN amount_usd END), 0) AS e7,
         COALESCE(SUM(CASE WHEN block_time >= ?2 THEN amount_usd END), 0) AS e30,
         COALESCE(SUM(amount_usd), 0) AS elife
       FROM agent_earnings WHERE is_earning = 1`
    )
    .bind(sevenAgo, thirtyAgo)
    .first<{ e7: number; e30: number; elife: number }>();

  const bySource = await db
    .prepare(
      `SELECT source_class, COALESCE(SUM(amount_usd), 0) AS total_usd
       FROM agent_earnings
       WHERE is_earning = 1 AND block_time >= ?1
       GROUP BY source_class ORDER BY total_usd DESC`
    )
    .bind(thirtyAgo)
    .all<SourceBreakdownEntry>();

  return {
    total_7d_usd: totals?.e7 ?? 0,
    total_30d_usd: totals?.e30 ?? 0,
    total_lifetime_usd: totals?.elife ?? 0,
    by_source_class_30d: bySource.results ?? [],
  };
}

export interface EarningsLeaderboardRow {
  stx_address: string;
  btc_address: string | null;
  display_name: string | null;
  bns_name: string | null;
  earnings_usd: number;
  unique_payers: number;
  latest_at: number | null;
}

/** Agents ranked by earnings in the window. Fetches `limit + 1` to derive hasMore. */
export async function getEarningsLeaderboard(
  db: D1Database,
  window: EarningsWindow,
  limit: number,
  offset: number,
  now: number
): Promise<EarningsLeaderboardRow[]> {
  const start = windowStart(window, now);
  const res = await db
    .prepare(
      `SELECT e.recipient_agent_stx AS stx_address, a.btc_address, a.display_name, a.bns_name,
              COALESCE(SUM(e.amount_usd), 0) AS earnings_usd,
              COUNT(DISTINCT e.sender_stx) AS unique_payers,
              MAX(e.block_time) AS latest_at
       FROM agent_earnings e
       LEFT JOIN agents a ON a.stx_address = e.recipient_agent_stx
       WHERE e.is_earning = 1 AND e.block_time >= ?1
       GROUP BY e.recipient_agent_stx
       HAVING earnings_usd > 0
       ORDER BY earnings_usd DESC, latest_at DESC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(start, limit, offset)
    .all<EarningsLeaderboardRow>();
  return res.results ?? [];
}
