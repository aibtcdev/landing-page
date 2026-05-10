/**
 * Pure reconciliation helpers for KV ↔ D1 drift analysis.
 *
 * These functions contain no I/O and are independently unit-testable.
 * The reconcile route composes these with KV/D1 calls.
 */

export type TableTarget = "agents" | "claims" | "inbox_messages" | "vouches";

export interface DriftBreakdown {
  /** Total KV keys scanned for this table (including Partial for agents). */
  kv_count_total: number;
  /**
   * For agents: KV count minus PartialAgentRecord entries.
   * For all other tables: same as kv_count_total (Partial exclusion is
   * only relevant for the agents table itself).
   */
  kv_count_full: number;
  /** D1 row count from SELECT COUNT(*). */
  d1_count: number;
  /**
   * kv_count_full - d1_count. Positive means KV has more rows than D1.
   * For a correct backfill this should equal drift_explained.
   */
  drift: number;
  /**
   * Rows whose FK target is a PartialAgentRecord — these are intentionally
   * absent from D1 per the Phase 1.3 design. For agents this is the count
   * of Partial entries; for claims/inbox/vouches it's the count of KV rows
   * whose parent agent is Partial (surfaced by the caller from backfill data).
   */
  drift_explained: number;
  /** drift - drift_explained, clamped to >= 0. Must be zero for Phase 2.x to start. */
  drift_unexplained: number;
  /**
   * Per-table breakdown of explained categories (inbox only currently uses these).
   * For agents/claims/vouches this is empty; for inbox it carries cascade/replay/stx counts.
   */
  explained_categories?: {
    partial_cascade?: number;
    unique_payment_txid_replay?: number;
    unresolvable_stx_reply?: number;
  };
}

/**
 * Compute drift breakdown from raw counts.
 *
 * `drift` is the gap between what KV has (excluding Partials) and what D1 has.
 * `drift_explained` is informational context: how many rows in KV are absent
 * from D1 due to FK cascade from Partial agents. It is independent of `drift`
 * and can exceed it (e.g., when kv_count_full already excludes Partial entries
 * and D1 count matches). Zero unexplained drift = Phase 2 gate passed.
 *
 * For agents: kv_count_full = kv_count_total - kv_count_partial; drift = kv_count_full - d1_count.
 * For claims/inbox/vouches: kv_count_full = kv_count_total; drift = kv_count_full - d1_count;
 *   drift_explained = rows whose FK parent agent is Partial.
 *
 * @param kv_count_total   - All KV entries for this table prefix
 * @param kv_count_partial - PartialAgentRecord count (agents only; 0 for other tables)
 * @param d1_count         - D1 SELECT COUNT(*) result
 * @param drift_explained  - Rows absent from D1 due to Partial FK cascade (caller-provided)
 */
export function computeDrift(
  kv_count_total: number,
  kv_count_partial: number,
  d1_count: number,
  drift_explained: number,
  explained_categories?: DriftBreakdown["explained_categories"]
): DriftBreakdown {
  const kv_count_full = kv_count_total - kv_count_partial;
  const drift = kv_count_full - d1_count;
  // Clamped to >= 0: drift_explained and drift are derived from independent passes
  // (KV-truth vs count math) and minor floor-skew is possible in transit.
  const drift_unexplained = Math.max(0, drift - drift_explained);
  return {
    kv_count_total,
    kv_count_full,
    d1_count,
    drift,
    drift_explained,
    drift_unexplained,
    ...(explained_categories ? { explained_categories } : {}),
  };
}

/**
 * Compute drift for the agents table.
 *
 * Partial entries are excluded from `kv_count_full` and do NOT contribute to
 * `drift` (drift = kv_count_full - d1_count). They are surfaced as
 * `drift_explained` to explain the gap between kv_count_total and d1_count
 * for human reviewers. If D1 == kv_count_full, drift = 0 and drift_unexplained = 0.
 */
export function computeAgentsDrift(
  kv_count_total: number,
  kv_count_partial: number,
  d1_count: number
): DriftBreakdown {
  const kv_count_full = kv_count_total - kv_count_partial;
  const drift = kv_count_full - d1_count;
  // For agents, any gap between kv_count_full and d1_count is unexplained by design
  // (partials are already excluded from both sides of the comparison).
  const drift_explained = kv_count_partial; // informational: total Partial count
  const drift_unexplained = drift; // anything beyond partial exclusion is unexplained
  return {
    kv_count_total,
    kv_count_full,
    d1_count,
    drift,
    drift_explained,
    drift_unexplained,
  };
}

/**
 * Result shape for a single table reconciliation.
 */
export interface TableReconcileResult {
  table: TableTarget;
  kv_count: number;
  /** Agents only: count of PartialAgentRecord entries excluded from kv_count. */
  kv_count_partial_excluded: number;
  d1_count: number;
  drift: number;
  drift_explained: number;
  drift_unexplained: number;
  /**
   * Per-table breakdown of explained categories (inbox only currently uses these).
   * For agents/claims/vouches this is empty; for inbox it carries cascade/replay/stx counts.
   */
  explained_categories?: {
    partial_cascade?: number;
    unique_payment_txid_replay?: number;
    unresolvable_stx_reply?: number;
  };
  sample_size: number;
  field_diffs: FieldDiff[];
  duration_ms: number;
}

/**
 * A field-level difference between a KV record and its D1 counterpart.
 */
export interface FieldDiff {
  key: string;
  field: string;
  kv_value: unknown;
  d1_value: unknown;
}

/**
 * unreadCount acceptance test result for a single address.
 */
export interface UnreadCountDriftEntry {
  address: string;
  kv_cached: number;
  d1_count: number;
  drift: number;
}

/**
 * Acceptance test results surfaced in the reconcile response.
 */
export interface AcceptanceTestResults {
  unread_count_drift: UnreadCountDriftEntry[];
  /** true if every sampled address has drift === 0 */
  passed: boolean;
}
