/**
 * Maintained-counter helpers for the `agent_swap_stats` table
 * (migration 016).
 *
 * The table mirrors `agent_inbox_stats` (migration 012) — single
 * row per `stx_address` carrying aggregates that would otherwise
 * require a full-row scan of `swaps` per request. See
 * `phases/P3B/pr2-plan.md` for the cost-driver attribution.
 *
 * Write path: `recordSwapInsert` is called by
 * `lib/competition/verify.ts:insertSwap` after every successful
 * INSERT (meta.changes === 1). Failures are caught + logged but
 * never propagated — a stats-write failure must not break swap
 * persistence (the live `swaps` row remains authoritative).
 *
 * Read path: `getSwapStats` is the O(1) point-lookup used by
 * `lib/competition/d1-reads.ts:countSwapsFromD1` and
 * `getCompetitionStatusFromD1`. Returns null on miss; callers
 * coalesce to zero/null as appropriate for their response shape.
 */

import type { Logger } from "@/lib/logging";

/** Shape returned by `getSwapStats`; matches the `agent_swap_stats` columns. */
export interface SwapStatsRow {
  stx_address: string;
  trade_count: number;
  verified_count: number;
  first_trade_at: number | null;
  last_trade_at: number | null;
  updated_at: string;
}

/**
 * Point-lookup for an agent's swap stats. Returns null when the
 * agent has no row in `agent_swap_stats` (no swaps yet, or the
 * row was never seeded). Callers should treat null as zero counts.
 */
export async function getSwapStats(
  db: D1Database,
  stxAddress: string
): Promise<SwapStatsRow | null> {
  const sql = `
    SELECT stx_address, trade_count, verified_count,
           first_trade_at, last_trade_at, updated_at
    FROM agent_swap_stats
    WHERE stx_address = ?1
  `;
  const row = await db.prepare(sql).bind(stxAddress).first<SwapStatsRow>();
  return row ?? null;
}

/**
 * UPSERT-increment the swap stats for a sender. Called on every
 * successful `swaps` INSERT. The first call for a sender inserts
 * a new row with `trade_count = 1`; subsequent calls bump the
 * counters and refresh first/last_trade_at via MIN/MAX so the
 * function is monotonic against clock skew on `burn_block_time`.
 *
 * Errors are caught and logged via the passed Logger (or console
 * fallback) — the caller is in the swap-persist hot path and a
 * stats-maintenance hiccup must not surface as a swap failure.
 */
export async function recordSwapInsert(
  db: D1Database,
  stxAddress: string,
  burnBlockTime: number,
  txStatus: string,
  logger?: Logger
): Promise<void> {
  const verifiedDelta = txStatus === "success" ? 1 : 0;
  const updatedAt = new Date().toISOString();
  // SQLite scalar `min(a, b)` / `max(a, b)` are NULL-aware:
  // `min(NULL, x)` returns NULL. The COALESCE wrappers ensure the
  // first INSERT (no existing row) and the UPSERT path treat NULL
  // as "no opinion" and let the incoming value win.
  const sql = `
    INSERT INTO agent_swap_stats
      (stx_address, trade_count, verified_count, first_trade_at, last_trade_at, updated_at)
    VALUES (?1, 1, ?2, ?3, ?3, ?4)
    ON CONFLICT(stx_address) DO UPDATE SET
      trade_count    = trade_count + 1,
      verified_count = verified_count + ?2,
      first_trade_at = min(COALESCE(first_trade_at, ?3), ?3),
      last_trade_at  = max(COALESCE(last_trade_at, ?3), ?3),
      updated_at     = ?4
  `;
  try {
    await db
      .prepare(sql)
      .bind(stxAddress, verifiedDelta, burnBlockTime, updatedAt)
      .run();
  } catch (e) {
    // Warn (not error) — a stats-maintenance failure is data drift, not
    // a hot bug: the authoritative `swaps` row was already INSERTed by
    // the caller, and the next successful recordSwapInsert for this
    // sender will reconcile via the ON CONFLICT branch. The fallback
    // path in countSwapsFromD1 also surfaces the drift if it persists.
    if (logger) {
      logger.warn("agent_swap_stats.record_failed", {
        stxAddress,
        error: (e as Error).message,
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[agent-swap-stats] recordSwapInsert failed for ${stxAddress}: ${(e as Error).message}`
      );
    }
  }
}

/**
 * Recompute every row of `agent_swap_stats` from a full
 * `swaps` GROUP BY scan. Idempotent — wipes existing rows and
 * re-inserts. Use only for:
 *   - Initial seed after migration apply.
 *   - Operator-triggered repair after admin mutations to `swaps`.
 *
 * NOT for hot-path use — this is the expensive query the rest of
 * the file exists to avoid.
 */
export async function rebuildSwapStats(db: D1Database): Promise<void> {
  const updatedAt = new Date().toISOString();
  // Single statement: clear + re-seed inside one prepared
  // batch. D1's executeMulti would let us do this in one round
  // trip, but a sequential pair is simpler to reason about and
  // the function is admin-only.
  await db.prepare("DELETE FROM agent_swap_stats").run();
  const sql = `
    INSERT INTO agent_swap_stats
      (stx_address, trade_count, verified_count, first_trade_at, last_trade_at, updated_at)
    SELECT
      sender                                                     AS stx_address,
      COUNT(*)                                                   AS trade_count,
      SUM(CASE WHEN tx_status = 'success' THEN 1 ELSE 0 END)     AS verified_count,
      MIN(burn_block_time)                                       AS first_trade_at,
      MAX(burn_block_time)                                       AS last_trade_at,
      ?1                                                         AS updated_at
    FROM swaps
    GROUP BY sender
  `;
  await db.prepare(sql).bind(updatedAt).run();
}
