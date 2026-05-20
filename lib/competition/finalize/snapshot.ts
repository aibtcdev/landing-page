/**
 * Price snapshot capture for competition round finalization.
 *
 * captureRoundPriceSnapshot reads the live Tenero KV cache and writes frozen
 * per-token prices to competition_round_price_snapshots. It also transitions
 * the round status from 'closed' → 'finalizing'.
 *
 * After this runs, computeRoundResults reads from the frozen snapshot — never
 * from the live KV cache — so results are reproducible even months later.
 *
 * decimalsMap: caller-provided Map<tokenId, decimals>. The Tenero KV cache
 * stores CachedTokenPrice (which does NOT include decimals), so the caller
 * must supply this from D1 swaps or a known-decimals lookup. Keeping the
 * decimals source external keeps this module pure and testable.
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 2.
 */

import { getCachedTokenPrices } from "@/lib/external/tenero/kv-cache";

// ── Options & result types ────────────────────────────────────────────────────

export interface SnapshotOpts {
  roundId: string;
  kv: KVNamespace;
  /** All token IDs to include in the snapshot. */
  tokenIds: readonly string[];
  /** Caller-provided decimals per token (e.g. 8 for sBTC, 6 for STX tokens). */
  decimalsMap: Map<string, number>;
  /** ISO-8601 timestamp for captured_at. Defaults to new Date().toISOString(). */
  now?: () => string;
}

export interface SnapshotResult {
  /** Number of tokens successfully priced and stored. */
  priced: number;
  /** Token IDs that had no price in KV (or priceUsd === null). */
  unpriced: string[];
}

/**
 * True for a non-negative integer in the SQLite INTEGER range we accept for
 * token decimals. Rejects NaN, Infinity, floats, negative values, and strings.
 */
function isValidDecimals(d: unknown): d is number {
  return typeof d === "number" && Number.isInteger(d) && d >= 0;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Capture Tenero KV prices into competition_round_price_snapshots and flip
 * competition_rounds.status from 'closed' → 'finalizing'.
 *
 * Concurrency / idempotency:
 *   - Pre-flight check fails fast if any price snapshot rows already exist
 *     for this round, so a partial second call can never append extra rows
 *     without flipping status.
 *   - The status UPDATE is the last statement in the batch and is gated on
 *     `status = 'closed'`. If a concurrent caller already flipped it, we
 *     detect zero changes and throw `concurrent_modification` after writing.
 *     (D1 batches don't roll back on logical no-ops, but the unique
 *     PRIMARY KEY (round_id, token_id) on the snapshot table means a second
 *     call hits a UNIQUE constraint before it can corrupt anything.)
 *
 * Pre-flight Tenero cache gate (per #880):
 *   - If `getCachedTokenPrices` returns zero priced entries for the requested
 *     tokenIds, throws `empty_price_cache` so the operator gets a clean
 *     signal instead of silently snapshotting an all-unpriced round.
 *
 * Throws:
 *   'round_not_found: {roundId}'                       — round does not exist
 *   'wrong_status: expected closed, got {status}'      — round is not in closed state
 *   'already_snapshotted: {roundId}'                   — price rows exist for this round
 *   'empty_price_cache: zero priced tokens'            — Tenero KV cache returned nothing usable
 *   'concurrent_modification: round {roundId} status changed during snapshot'
 */
export async function captureRoundPriceSnapshot(
  db: D1Database,
  opts: SnapshotOpts
): Promise<SnapshotResult> {
  const { roundId, kv, tokenIds, decimalsMap } = opts;
  const capturedAt = (opts.now ?? (() => new Date().toISOString()))();

  // ── 1. Assert round is in 'closed' state ───────────────────────────────────
  const roundRow = await db
    .prepare("SELECT status FROM competition_rounds WHERE round_id = ?1")
    .bind(roundId)
    .first<{ status: string }>();

  if (!roundRow) {
    throw new Error(`round_not_found: ${roundId}`);
  }

  if (roundRow.status !== "closed") {
    throw new Error(
      `wrong_status: expected closed, got ${roundRow.status}`
    );
  }

  // ── 2. Idempotency guard: refuse if snapshot rows already exist ───────────
  const existsRow = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM competition_round_price_snapshots WHERE round_id = ?1"
    )
    .bind(roundId)
    .first<{ cnt: number }>();

  if (existsRow && existsRow.cnt > 0) {
    throw new Error(`already_snapshotted: ${roundId}`);
  }

  // ── 3. Fetch prices from Tenero KV ────────────────────────────────────────
  const priceCache = await getCachedTokenPrices(kv, tokenIds);

  // ── 4. Classify tokens as priced vs unpriced ──────────────────────────────
  const pricedRows: Array<{
    tokenId: string;
    priceUsd: number;
    decimals: number;
  }> = [];
  const unpriced: string[] = [];

  for (const tokenId of tokenIds) {
    const cached = priceCache.get(tokenId);
    const decimals = decimalsMap.get(tokenId);
    if (
      cached &&
      cached.priceUsd !== null &&
      typeof cached.priceUsd === "number" &&
      Number.isFinite(cached.priceUsd) &&
      isValidDecimals(decimals)
    ) {
      pricedRows.push({ tokenId, priceUsd: cached.priceUsd, decimals });
    } else {
      unpriced.push(tokenId);
    }
  }

  // ── 5. Pre-flight cache gate: refuse if zero priced (per #880) ───────────
  if (pricedRows.length === 0) {
    throw new Error(
      `empty_price_cache: zero priced tokens (requested ${tokenIds.length}); ` +
        `check Tenero refresh scheduler is running (see issue #880)`
    );
  }

  // ── 6. Write to D1 in a single batch ──────────────────────────────────────
  const insertSql = `
    INSERT INTO competition_round_price_snapshots
      (round_id, token_id, price_usd, decimals, source, captured_at)
    VALUES (?1, ?2, ?3, ?4, 'tenero', ?5)
  `;

  const updateSql = `
    UPDATE competition_rounds
    SET status = 'finalizing'
    WHERE round_id = ?1 AND status = 'closed'
  `;

  const statements: D1PreparedStatement[] = [
    ...pricedRows.map((r) =>
      db
        .prepare(insertSql)
        .bind(roundId, r.tokenId, r.priceUsd, r.decimals, capturedAt)
    ),
    db.prepare(updateSql).bind(roundId),
  ];

  const batchResults = await db.batch(statements);

  // Verify the UPDATE (last statement) actually flipped the row. Concurrent
  // callers can race the read → write window; if status changed under us,
  // surface that explicitly rather than reporting a silent success.
  const updateMeta = batchResults[batchResults.length - 1];
  if (updateMeta.meta.changes === 0) {
    throw new Error(
      `concurrent_modification: round ${roundId} status changed during snapshot`
    );
  }

  return { priced: pricedRows.length, unpriced };
}
