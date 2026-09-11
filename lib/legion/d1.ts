/**
 * D1 event store for the legions (table `legion_events`, migration 028).
 *
 * The write path is the chainhook webhook; the read path folds every stored
 * event into proposals on read. Raw events are the source of truth, idempotent
 * by (txid, event_index).
 *
 * One ingest source only. A chainhook delivery and Hiro's
 * `/extended/v1/contract/{id}/events` number the same print DIFFERENTLY, so a
 * backfill that read the events API would land every event twice under the
 * primary key and double-count every vote. Past blocks are replayed through the
 * hook itself (`scripts/legion-chainhook.sh evaluate <block>`).
 */

import type { EventRow } from "./chainhook";

interface StoredRow {
  txid: string;
  event_index: number;
  contract_id: string;
  proposal_id: number | null;
  block_height: number;
  block_time: number | null;
  event: string;
  payload: string;
  recorded_at: number;
}

/** Upsert decoded events. Returns how many rows were in the batch. */
export async function recordLegionEvents(db: D1Database, events: readonly EventRow[]): Promise<number> {
  if (events.length === 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO legion_events
      (txid, event_index, contract_id, proposal_id, block_height, block_time, event, payload, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(txid, event_index) DO UPDATE SET
      contract_id  = excluded.contract_id,
      proposal_id  = excluded.proposal_id,
      block_height = excluded.block_height,
      block_time   = excluded.block_time,
      event        = excluded.event,
      payload      = excluded.payload
  `);
  await db.batch(
    events.map((e) =>
      stmt.bind(
        e.txid,
        e.event_index,
        e.contract_id,
        e.proposal_id,
        e.block_height,
        e.block_time,
        e.event,
        JSON.stringify(e.data),
        now
      )
    )
  );
  return events.length;
}

/** Drop every event from the given transactions (reorg rollback). */
export async function rollbackLegionEvents(db: D1Database, txids: readonly string[]): Promise<number> {
  if (txids.length === 0) return 0;
  const stmt = db.prepare(`DELETE FROM legion_events WHERE txid = ?`);
  const results = await db.batch(txids.map((t) => stmt.bind(t)));
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

/**
 * Newest-first events across the given contracts. Each id is an equality match
 * on the leading column of idx_legion_events_contract, so the IN is one index
 * seek per contract, not a scan.
 */
export async function listLegionEvents(
  db: D1Database,
  contracts: readonly string[],
  limit = 2_000
): Promise<EventRow[]> {
  if (contracts.length === 0) return [];
  const placeholders = contracts.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT txid, event_index, contract_id, proposal_id, block_height, block_time, event, payload, recorded_at
         FROM legion_events
        WHERE contract_id IN (${placeholders})
        ORDER BY block_height DESC, event_index DESC
        LIMIT ?`
    )
    .bind(...contracts, limit)
    .all<StoredRow>();

  return (results ?? []).map((r) => ({
    txid: r.txid,
    event_index: r.event_index,
    contract_id: r.contract_id,
    proposal_id: r.proposal_id,
    block_height: r.block_height,
    block_time: r.block_time,
    event: r.event,
    data: JSON.parse(r.payload) as Record<string, unknown>,
    recorded_at: r.recorded_at,
  }));
}
