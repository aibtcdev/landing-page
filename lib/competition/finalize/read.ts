/**
 * D1 read helpers for finalized competition round data.
 *
 * These helpers are the sole D1 access point for the four public read
 * endpoints added in quest 2026-05-20-competition-rounds-read-endpoints:
 *
 *   GET /api/competition/rounds
 *   GET /api/competition/rounds/[roundId]
 *   GET /api/competition/rounds/[roundId]/results/[stxAddress]
 *   GET /api/competition/status?address=... (latestRoundResult extension)
 *
 * Routes stay thin — all SQL lives here.
 *
 * Visibility filter: all read helpers restrict to rounds with status in
 * ('finalized', 'partially_paid', 'paid'). In-flight rounds (open, closed,
 * finalizing) are excluded from public read surfaces.
 *
 * result_json: D1 stores this column as TEXT. All helpers that return
 * RoundResult call parseResultJson() before constructing the typed interface.
 * Never call JSON.parse directly on result_json.
 *
 * Quest: 2026-05-20-competition-rounds-read-endpoints, Phase 1.
 */

import {
  parseResultJson,
  type CompetitionRound,
  type CompetitionReward,
  type RoundResult,
} from "./types";

// ── Visibility filter ─────────────────────────────────────────────────────────

/**
 * Statuses that are visible on the public read surface.
 * In-flight rounds (open, closed, finalizing) are never returned.
 */
const VISIBLE_STATUSES = `('finalized','partially_paid','paid')`;

// ── Internal D1 row types ─────────────────────────────────────────────────────

/** Raw D1 row for competition_round_results. result_json is TEXT, not object. */
interface D1RoundResultRow {
  round_id: string;
  rank: number;
  stx_address: string;
  btc_address: string;
  erc8004_agent_id: number | null;
  trade_count: number;
  priced_trade_count: number;
  unpriced_trade_count: number;
  volume_usd: number;
  received_usd: number;
  pnl_usd: number;
  pnl_percent: number | null;
  latest_trade_at: number | null;
  result_json: string; // TEXT in D1; must be parsed with parseResultJson()
  calculated_at: string;
}

/** Map a raw D1 result row to the public RoundResult type. */
function mapRoundResult(row: D1RoundResultRow): RoundResult {
  return {
    round_id: row.round_id,
    rank: row.rank,
    stx_address: row.stx_address,
    btc_address: row.btc_address,
    erc8004_agent_id: row.erc8004_agent_id ?? null,
    trade_count: row.trade_count,
    priced_trade_count: row.priced_trade_count,
    unpriced_trade_count: row.unpriced_trade_count,
    volume_usd: row.volume_usd,
    received_usd: row.received_usd,
    pnl_usd: row.pnl_usd,
    pnl_percent: row.pnl_percent ?? null,
    latest_trade_at: row.latest_trade_at ?? null,
    result_json: parseResultJson(row.result_json),
    calculated_at: row.calculated_at,
  };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * List finalized competition rounds, newest first.
 *
 * Only rounds with status in ('finalized', 'partially_paid', 'paid') are
 * returned — in-flight rounds are excluded from the public surface.
 *
 * SQL shape:
 *   SELECT * FROM competition_rounds
 *   WHERE status IN ('finalized','partially_paid','paid')
 *   ORDER BY starts_at DESC
 *   LIMIT ?1 OFFSET ?2
 */
export async function listFinalizedRounds(
  db: D1Database,
  opts: { limit: number; offset: number }
): Promise<CompetitionRound[]> {
  const sql = `
    SELECT
      round_id, starts_at, ends_at, grace_ends_at, status,
      min_volume_usd, min_priced_trade_count, created_at, finalized_at
    FROM competition_rounds
    WHERE status IN ${VISIBLE_STATUSES}
    ORDER BY starts_at DESC
    LIMIT ?1 OFFSET ?2
  `;

  const result = await db
    .prepare(sql)
    .bind(opts.limit, opts.offset)
    .all<CompetitionRound>();

  return result.results ?? [];
}

/**
 * Fetch a single finalized round by ID.
 *
 * Returns null when the round does not exist OR when its status is not in
 * the visible set (open, closed, finalizing rounds return null — not 404).
 * Routes should respond with 404 on null.
 *
 * SQL shape:
 *   SELECT * FROM competition_rounds
 *   WHERE round_id = ?1
 *     AND status IN ('finalized','partially_paid','paid')
 */
export async function getFinalizedRound(
  db: D1Database,
  roundId: string
): Promise<CompetitionRound | null> {
  const sql = `
    SELECT
      round_id, starts_at, ends_at, grace_ends_at, status,
      min_volume_usd, min_priced_trade_count, created_at, finalized_at
    FROM competition_rounds
    WHERE round_id = ?1
      AND status IN ${VISIBLE_STATUSES}
  `;

  const row = await db.prepare(sql).bind(roundId).first<CompetitionRound>();
  return row ?? null;
}

/**
 * Fetch all result rows for a finalized round, ranked ascending.
 *
 * Calls parseResultJson on each result_json TEXT column before returning.
 * Returns [] when the round has no results or does not exist.
 *
 * SQL shape:
 *   SELECT * FROM competition_round_results
 *   WHERE round_id = ?1
 *   ORDER BY rank ASC
 */
export async function getRoundResults(
  db: D1Database,
  roundId: string
): Promise<RoundResult[]> {
  const sql = `
    SELECT
      round_id, rank, stx_address, btc_address, erc8004_agent_id,
      trade_count, priced_trade_count, unpriced_trade_count,
      volume_usd, received_usd, pnl_usd, pnl_percent,
      latest_trade_at, result_json, calculated_at
    FROM competition_round_results
    WHERE round_id = ?1
    ORDER BY rank ASC
  `;

  const result = await db
    .prepare(sql)
    .bind(roundId)
    .all<D1RoundResultRow>();

  return (result.results ?? []).map(mapRoundResult);
}

/**
 * Fetch a single agent's result row for a given round.
 *
 * Calls parseResultJson on result_json TEXT before returning.
 * Returns null when the agent has no result in the round (never competed,
 * or round not yet finalized).
 *
 * SQL shape:
 *   SELECT * FROM competition_round_results
 *   WHERE round_id = ?1 AND stx_address = ?2
 */
export async function getRoundResultForAgent(
  db: D1Database,
  roundId: string,
  stxAddress: string
): Promise<RoundResult | null> {
  const sql = `
    SELECT
      round_id, rank, stx_address, btc_address, erc8004_agent_id,
      trade_count, priced_trade_count, unpriced_trade_count,
      volume_usd, received_usd, pnl_usd, pnl_percent,
      latest_trade_at, result_json, calculated_at
    FROM competition_round_results
    WHERE round_id = ?1 AND stx_address = ?2
  `;

  const row = await db
    .prepare(sql)
    .bind(roundId, stxAddress)
    .first<D1RoundResultRow>();

  return row ? mapRoundResult(row) : null;
}

/**
 * Fetch all reward rows for a finalized round, ordered by category.
 *
 * Returns [] when no rewards exist (e.g. round not yet finalized).
 *
 * SQL shape:
 *   SELECT * FROM competition_rewards
 *   WHERE round_id = ?1
 *   ORDER BY category ASC
 */
export async function getRoundRewards(
  db: D1Database,
  roundId: string
): Promise<CompetitionReward[]> {
  const sql = `
    SELECT
      round_id, category, rank, stx_address, erc8004_agent_id,
      amount_sats, status, payout_txid, paid_at, notes, created_at
    FROM competition_rewards
    WHERE round_id = ?1
    ORDER BY category ASC
  `;

  const result = await db
    .prepare(sql)
    .bind(roundId)
    .all<CompetitionReward>();

  return result.results ?? [];
}

/**
 * Fetch the most recent finalized round result for an agent.
 *
 * Used by the /api/competition/status extension to show an agent's latest
 * round performance alongside their current trading stats.
 *
 * Only looks at rounds with visible status (finalized, partially_paid, paid).
 * Calls parseResultJson on result_json TEXT before returning.
 * Returns null when the agent has no placements in any finalized round.
 *
 * SQL shape:
 *   SELECT crr.*
 *   FROM competition_round_results crr
 *   JOIN competition_rounds cr ON cr.round_id = crr.round_id
 *   WHERE crr.stx_address = ?1
 *     AND cr.status IN ('finalized','partially_paid','paid')
 *   ORDER BY cr.starts_at DESC
 *   LIMIT 1
 */
export async function getLatestFinalizedRoundResultForAgent(
  db: D1Database,
  stxAddress: string
): Promise<RoundResult | null> {
  const sql = `
    SELECT
      crr.round_id, crr.rank, crr.stx_address, crr.btc_address, crr.erc8004_agent_id,
      crr.trade_count, crr.priced_trade_count, crr.unpriced_trade_count,
      crr.volume_usd, crr.received_usd, crr.pnl_usd, crr.pnl_percent,
      crr.latest_trade_at, crr.result_json, crr.calculated_at
    FROM competition_round_results crr
    JOIN competition_rounds cr ON cr.round_id = crr.round_id
    WHERE crr.stx_address = ?1
      AND cr.status IN ${VISIBLE_STATUSES}
    ORDER BY cr.starts_at DESC
    LIMIT 1
  `;

  const row = await db
    .prepare(sql)
    .bind(stxAddress)
    .first<D1RoundResultRow>();

  return row ? mapRoundResult(row) : null;
}
