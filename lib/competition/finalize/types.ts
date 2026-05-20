/**
 * TypeScript interfaces mirroring the competition round snapshot schema
 * (migration 017_competition_rounds.sql).
 *
 * These types are shared by:
 *   - lib/competition/finalize/compute.ts  (Phase 2 — compute logic)
 *   - lib/competition/finalize/persist.ts  (Phase 2 — D1 write helpers)
 *   - lib/competition/finalize/snapshot.ts (Phase 2 — price capture)
 *   - app/api/admin/competition/finalize/  (Phase 3 — admin route)
 *
 * NaN guard: pnl_percent is typed as `number | null`. It is stored as NULL
 * in D1 when volume_usd = 0 (division-by-zero undefined). NULL is treated as
 * ineligible for Return Champion. Zero-volume agents still appear in Overall
 * P&L and Volume rankings if otherwise qualified.
 *
 * result_json: D1 stores this as TEXT, but this module owns the typed shape
 * and the runtime deserializer (parseResultJson). All callers should use
 * parseResultJson rather than JSON.parse directly so shape changes are caught
 * in one place.
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 1.
 */

// ── ResultJson ────────────────────────────────────────────────────────────────

/**
 * Typed shape for competition_round_results.result_json.
 *
 * source_counts: breakdown of scored swaps by ingestion source.
 * unpriced_tokens: token_ids that had no price snapshot — their swaps
 *   were excluded from volume_usd / pnl_usd calculations.
 */
export interface ResultJson {
  source_counts: {
    agent: number;
    cron: number;
    chainhook: number;
  };
  unpriced_tokens: string[];
}

/** Zero-value ResultJson used as a safe fallback on parse failure. */
function emptyResultJson(): ResultJson {
  return {
    source_counts: { agent: 0, cron: 0, chainhook: 0 },
    unpriced_tokens: [],
  };
}

/**
 * Deserialize a raw JSON string from D1 into a typed ResultJson.
 *
 * Graceful degradation: returns emptyResultJson() on any parse error or
 * missing fields so that stored rows are always readable even if the shape
 * evolves between writes and reads.
 */
export function parseResultJson(raw: string): ResultJson {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyResultJson();

    const obj = parsed as Record<string, unknown>;

    // Validate source_counts
    const sc = obj.source_counts;
    if (typeof sc !== "object" || sc === null) return emptyResultJson();
    const counts = sc as Record<string, unknown>;
    const agent = typeof counts.agent === "number" ? counts.agent : 0;
    const cron = typeof counts.cron === "number" ? counts.cron : 0;
    const chainhook =
      typeof counts.chainhook === "number" ? counts.chainhook : 0;

    // Validate unpriced_tokens
    const ut = obj.unpriced_tokens;
    const unpriced_tokens: string[] = Array.isArray(ut)
      ? (ut as unknown[]).filter((t): t is string => typeof t === "string")
      : [];

    return {
      source_counts: { agent, cron, chainhook },
      unpriced_tokens,
    };
  } catch {
    return emptyResultJson();
  }
}

// ── Round status ──────────────────────────────────────────────────────────────

/**
 * Status machine for competition_rounds.
 *
 *   open         → closed      : grace_ends_at has passed
 *   closed       → finalizing  : price snapshot captured
 *   finalizing   → finalized   : results + rewards rows written
 *   finalized    → partially_paid : at least one reward row has been paid
 *   partially_paid → paid      : all reward rows settled
 *
 * 'partially_paid' allows per-row payout retry without blocking the round.
 */
export type RoundStatus =
  | "open"
  | "closed"
  | "finalizing"
  | "finalized"
  | "partially_paid"
  | "paid";

// ── competition_rounds ────────────────────────────────────────────────────────

/** Mirrors the competition_rounds D1 table. */
export interface CompetitionRound {
  round_id: string;
  starts_at: number; // unix epoch seconds
  ends_at: number; // unix epoch seconds
  /** 60-min default after ends_at. See migration comment on Stacks block time. */
  grace_ends_at: number; // unix epoch seconds
  status: RoundStatus;
  min_volume_usd: number;
  min_priced_trade_count: number;
  created_at: string; // ISO-8601
  finalized_at: string | null; // ISO-8601, set on finalization
}

// ── competition_round_price_snapshots ─────────────────────────────────────────

/** Source of a price snapshot row. */
export type PriceSnapshotSource = "tenero" | "manual_admin";

/** Mirrors the competition_round_price_snapshots D1 table. */
export interface RoundPriceSnapshot {
  round_id: string;
  token_id: string;
  price_usd: number;
  decimals: number;
  source: PriceSnapshotSource;
  captured_at: string; // ISO-8601
}

// ── competition_round_results ─────────────────────────────────────────────────

/**
 * Mirrors the competition_round_results D1 table.
 *
 * result_json is typed as ResultJson here; callers reading from D1 must
 * pass the raw TEXT through parseResultJson before constructing this interface.
 */
export interface RoundResult {
  round_id: string;
  rank: number;
  stx_address: string;
  btc_address: string;
  /** Null if the agent has not minted an ERC-8004 identity NFT. */
  erc8004_agent_id: number | null;
  trade_count: number;
  priced_trade_count: number;
  unpriced_trade_count: number;
  volume_usd: number;
  received_usd: number;
  pnl_usd: number;
  /**
   * Null when volume_usd === 0 (NaN guard).
   * Agents with null pnl_percent are ineligible for Return Champion.
   * Expressed as a decimal fraction (e.g. 0.15 = 15%).
   */
  pnl_percent: number | null;
  /** Null when the agent has no swaps in the competition window. */
  latest_trade_at: number | null;
  result_json: ResultJson;
  calculated_at: string; // ISO-8601
}

// ── competition_rewards ───────────────────────────────────────────────────────

/** Reward category. One row per category per round. */
export type RewardCategory = "overall_pnl" | "volume" | "return";

/** Lifecycle status for a competition_rewards row. */
export type RewardStatus = "pending" | "paid" | "failed" | "void";

/** Mirrors the competition_rewards D1 table. */
export interface CompetitionReward {
  round_id: string;
  category: RewardCategory;
  rank: number;
  /** Snapshot of the winner's STX address at finalization time. Immutable. */
  stx_address: string;
  /** Null if the winner had no ERC-8004 identity at finalization time. */
  erc8004_agent_id: number | null;
  amount_sats: number;
  status: RewardStatus;
  /** Set when status transitions to 'paid'. */
  payout_txid: string | null;
  paid_at: string | null; // ISO-8601
  notes: string | null;
  created_at: string; // ISO-8601
}
