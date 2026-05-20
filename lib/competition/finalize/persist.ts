/**
 * D1 write helpers for competition round finalization.
 *
 * persistRoundResults writes competition_round_results and competition_rewards
 * rows inside a single D1 batch, then flips competition_rounds.status from
 * 'finalizing' to 'finalized'.
 *
 * Idempotency guard: throws 'already_finalized' if competition_round_results
 * rows already exist for the given round_id. Re-finalization requires an
 * admin-only DELETE of existing rows first.
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 2.
 */

import type { RoundResult, CompetitionReward } from "./types";

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Write finalized round results to D1 in a single atomic batch.
 *
 * Batch contains:
 *   1. N INSERT INTO competition_round_results (one per result row)
 *   2. M INSERT INTO competition_rewards (one per reward, typically 3)
 *   3. 1 UPDATE competition_rounds SET status='finalized', finalized_at=now
 *
 * Throws:
 *   'already_finalized: {roundId}' — results rows exist for this round
 *   'unexpected_status: round {roundId} not in finalizing state' — UPDATE changed 0 rows
 */
export async function persistRoundResults(
  db: D1Database,
  roundId: string,
  results: RoundResult[],
  rewards: CompetitionReward[]
): Promise<void> {
  // Idempotency check: fail fast if results already written
  const existsRow = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM competition_round_results WHERE round_id = ?1"
    )
    .bind(roundId)
    .first<{ cnt: number }>();

  if (existsRow && existsRow.cnt > 0) {
    throw new Error(`already_finalized: ${roundId}`);
  }

  const finalizedAt = new Date().toISOString();

  // Build batch statements
  const statements: D1PreparedStatement[] = [];

  // 1. Insert result rows
  const resultInsertSql = `
    INSERT INTO competition_round_results
      (round_id, rank, stx_address, btc_address, erc8004_agent_id,
       trade_count, priced_trade_count, unpriced_trade_count,
       volume_usd, received_usd, pnl_usd, pnl_percent,
       latest_trade_at, result_json, calculated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
  `;
  for (const r of results) {
    statements.push(
      db
        .prepare(resultInsertSql)
        .bind(
          r.round_id,
          r.rank,
          r.stx_address,
          r.btc_address,
          r.erc8004_agent_id,
          r.trade_count,
          r.priced_trade_count,
          r.unpriced_trade_count,
          r.volume_usd,
          r.received_usd,
          r.pnl_usd,
          r.pnl_percent, // null maps to D1 NULL via .bind()
          r.latest_trade_at,
          JSON.stringify(r.result_json),
          r.calculated_at
        )
    );
  }

  // 2. Insert reward rows
  const rewardInsertSql = `
    INSERT INTO competition_rewards
      (round_id, category, rank, stx_address, erc8004_agent_id,
       amount_sats, status, payout_txid, paid_at, notes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, NULL, ?7)
  `;
  for (const rw of rewards) {
    statements.push(
      db
        .prepare(rewardInsertSql)
        .bind(
          rw.round_id,
          rw.category,
          rw.rank,
          rw.stx_address,
          rw.erc8004_agent_id,
          rw.amount_sats,
          rw.created_at
        )
    );
  }

  // 3. Flip round status to finalized
  const updateSql = `
    UPDATE competition_rounds
    SET status = 'finalized', finalized_at = ?2
    WHERE round_id = ?1 AND status = 'finalizing'
  `;
  statements.push(db.prepare(updateSql).bind(roundId, finalizedAt));

  // Execute all statements atomically
  const batchResults = await db.batch(statements);

  // Verify the UPDATE landed (last statement in the batch)
  const updateResult = batchResults[batchResults.length - 1];
  if (updateResult.meta.changes === 0) {
    throw new Error(
      `unexpected_status: round ${roundId} not in finalizing state`
    );
  }
}
