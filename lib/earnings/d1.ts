/**
 * D1 persistence for the earnings indexer (issue #978, Phase 1).
 *
 * - agent_earnings: idempotent INSERT OR IGNORE on (tx_id, event_index).
 * - earnings_index_state: per-agent high-water mark + backfill progress.
 * - competition_state: reused for the round-robin sweep cursor.
 * - registered_wallets: the agent address input set (cursor-paginated).
 */

import { EARNINGS_CURSOR_KEY } from "./constants";
import type { EarningRow } from "./types";

export interface IndexState {
  lastIndexedBlock: number;
  backfillOffset: number;
  backfillComplete: boolean;
}

export async function getIndexState(
  db: D1Database,
  agentStx: string
): Promise<IndexState> {
  const row = await db
    .prepare(
      `SELECT last_indexed_block, backfill_offset, backfill_complete
       FROM earnings_index_state WHERE agent_stx = ?1`
    )
    .bind(agentStx)
    .first<{
      last_indexed_block: number;
      backfill_offset: number;
      backfill_complete: number;
    }>();
  return {
    lastIndexedBlock: row?.last_indexed_block ?? 0,
    backfillOffset: row?.backfill_offset ?? 0,
    backfillComplete: (row?.backfill_complete ?? 0) === 1,
  };
}

export async function setIndexState(
  db: D1Database,
  agentStx: string,
  state: IndexState,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO earnings_index_state
         (agent_stx, last_indexed_block, backfill_offset, backfill_complete, last_indexed_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(agent_stx) DO UPDATE SET
         last_indexed_block = excluded.last_indexed_block,
         backfill_offset    = excluded.backfill_offset,
         backfill_complete  = excluded.backfill_complete,
         last_indexed_at    = excluded.last_indexed_at`
    )
    .bind(
      agentStx,
      state.lastIndexedBlock,
      state.backfillOffset,
      state.backfillComplete ? 1 : 0,
      now
    )
    .run();
}

/** Persist ledger rows; returns inserted vs already-known (idempotent). */
export async function persistEarningRows(
  db: D1Database,
  rows: EarningRow[]
): Promise<{ inserted: number; alreadyKnown: number }> {
  if (rows.length === 0) return { inserted: 0, alreadyKnown: 0 };

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO agent_earnings
       (tx_id, event_index, stx_block_height, block_time, recipient_agent_stx, sender_stx,
        asset, amount_raw, amount_usd, price_usd, price_source, priced_at,
        source_class, source_subclass, excluded_reason, is_earning, indexed_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`
  );

  const batch = rows.map((r) =>
    stmt.bind(
      r.txId,
      r.eventIndex,
      r.stxBlockHeight,
      r.blockTime,
      r.recipientAgentStx,
      r.senderStx,
      r.asset,
      r.amountRaw,
      r.amountUsd,
      r.priceUsd,
      r.priceSource,
      r.pricedAt,
      r.sourceClass,
      r.sourceSubclass,
      r.excludedReason,
      r.isEarning ? 1 : 0,
      r.indexedAt
    )
  );

  const res = await db.batch(batch);
  // INSERT OR IGNORE: meta.changes is 1 when inserted, 0 when the row already
  // existed — so the sum is the true insert count.
  let inserted = 0;
  for (const r of res) inserted += r.meta?.changes ?? 0;
  return { inserted, alreadyKnown: rows.length - inserted };
}

export async function getEarningsCursor(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM competition_state WHERE key = ?1`)
    .bind(EARNINGS_CURSOR_KEY)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setEarningsCursor(
  db: D1Database,
  cursor: string | null
): Promise<void> {
  if (cursor === null) {
    await db
      .prepare(`DELETE FROM competition_state WHERE key = ?1`)
      .bind(EARNINGS_CURSOR_KEY)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO competition_state (key, value, updated_at)
       VALUES (?1, ?2, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(EARNINGS_CURSOR_KEY, cursor)
    .run();
}

/** Next page of agent STX addresses, ordered by stx_address for stable cursoring. */
export async function fetchAgentPage(
  db: D1Database,
  cursor: string | null,
  limit: number
): Promise<string[]> {
  const sql = cursor
    ? `SELECT stx_address FROM registered_wallets WHERE stx_address > ?1 ORDER BY stx_address ASC LIMIT ?2`
    : `SELECT stx_address FROM registered_wallets ORDER BY stx_address ASC LIMIT ?1`;
  const stmt = cursor
    ? db.prepare(sql).bind(cursor, limit)
    : db.prepare(sql).bind(limit);
  const res = await stmt.all<{ stx_address: string }>();
  return (res.results ?? []).map((r) => r.stx_address);
}
