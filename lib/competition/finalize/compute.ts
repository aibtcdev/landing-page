/**
 * Pure compute pass for competition round finalization.
 *
 * computeRoundResults reads from D1 (competition_rounds,
 * competition_round_price_snapshots, swaps + agents) and returns the full
 * competition_round_results row set plus the three competition_rewards rows
 * (overall_pnl, volume, return). It does NOT write to D1 — all writes are
 * delegated to persist.ts.
 *
 * Eligibility predicate matches LEADERBOARD_AGGREGATE_SQL exactly:
 *   - tx_status = 'success'
 *   - source IN ('agent', 'cron', 'chainhook')
 *   - burn_block_time within [round.starts_at, round.ends_at)
 *   - INNER JOIN agents (erc8004_agent_id IS NOT NULL)
 *   - EXISTS claims with status IN ('verified', 'rewarded')  ← Genesis gate
 *
 * Financial formulas:
 *   volume_usd   = SUM(amount_in  / 10^decimals_in  * price_usd_in)
 *   received_usd = SUM(amount_out / 10^decimals_out * price_usd_out)
 *   pnl_usd      = received_usd - volume_usd
 *   pnl_percent  = pnl_usd / volume_usd  (NULL when volume_usd = 0 — NaN guard)
 *
 * Ranking: pnl_usd DESC, tiebreak volume_usd DESC. Rank is 1-based, dense.
 *
 * Reward categories:
 *   overall_pnl — rank-1 agent by pnl_usd (tiebreak volume_usd)
 *   volume      — agent with highest volume_usd
 *   return      — agent with highest pnl_percent, gated by min_volume_usd
 *                 and min_priced_trade_count (NULL pnl_percent excluded)
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 2.
 */

import type {
  CompetitionRound,
  RoundResult,
  CompetitionReward,
  ResultJson,
  RewardCategory,
} from "./types";

// ── Options ──────────────────────────────────────────────────────────────────

export interface ComputeOpts {
  roundId: string;
  /** ISO-8601 timestamp injected as calculated_at. Defaults to new Date().toISOString(). */
  now?: () => string;
}

// ── Internal aggregate shape ──────────────────────────────────────────────────

interface TokenPair {
  token_in: string;
  token_out: string;
  sum_in: number;
  sum_out: number;
  cnt: number;
}

interface AgentSwapAggregate {
  stx_address: string;
  btc_address: string;
  erc8004_agent_id: number | null;
  trade_count: number;
  source_counts: { agent: number; cron: number; chainhook: number };
  token_pairs: TokenPair[];
  latest_at: number | null;
}

// ── D1 row types ──────────────────────────────────────────────────────────────

interface D1RoundRow {
  round_id: string;
  starts_at: number;
  ends_at: number;
  grace_ends_at: number;
  status: string;
  min_volume_usd: number;
  min_priced_trade_count: number;
  created_at: string;
  finalized_at: string | null;
}

interface D1PriceSnapshotRow {
  token_id: string;
  price_usd: number;
  decimals: number;
}

interface D1SwapAggRow {
  sender: string;
  token_in: string;
  token_out: string;
  cnt: number;
  sum_in: number;
  sum_out: number;
  latest_at: number;
  btc_address: string;
  erc8004_agent_id: number | null;
  source: string;
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/**
 * Aggregate eligible swaps per (sender, token_in, token_out, source) within
 * the round window. Mirrors LEADERBOARD_AGGREGATE_SQL eligibility predicate
 * exactly, with the addition of the round time-window filter.
 *
 * Grouped by source so we can accumulate source_counts per agent.
 */
const ROUND_SWAP_AGGREGATE_SQL = `
  SELECT s.sender, s.token_in, s.token_out,
         COUNT(*)              AS cnt,
         SUM(s.amount_in)      AS sum_in,
         SUM(s.amount_out)     AS sum_out,
         MAX(s.burn_block_time) AS latest_at,
         a.btc_address, a.erc8004_agent_id,
         s.source
  FROM swaps s
  INNER JOIN agents a ON a.stx_address = s.sender
  WHERE s.tx_status = 'success'
    AND s.source IN ('agent', 'cron', 'chainhook')
    AND s.burn_block_time >= ?1
    AND s.burn_block_time < ?2
    AND a.erc8004_agent_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM claims c
      WHERE c.btc_address = a.btc_address
        AND c.status IN ('verified', 'rewarded')
    )
  GROUP BY s.sender, s.token_in, s.token_out, s.source
`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute final round results and reward winners from frozen price snapshots.
 *
 * Reads:
 *   competition_rounds               → round window + floor gates
 *   competition_round_price_snapshots → frozen token prices + decimals
 *   swaps + agents + claims           → eligible swap aggregates
 *
 * Returns typed rows ready for persistRoundResults().
 * Does NOT write to D1.
 */
export async function computeRoundResults(
  db: D1Database,
  opts: ComputeOpts
): Promise<{ results: RoundResult[]; rewards: CompetitionReward[] }> {
  const { roundId } = opts;
  const calculatedAt = (opts.now ?? (() => new Date().toISOString()))();

  // ── 1. Fetch round ─────────────────────────────────────────────────────────
  const roundRow = await db
    .prepare("SELECT * FROM competition_rounds WHERE round_id = ?1")
    .bind(roundId)
    .first<D1RoundRow>();

  if (!roundRow) {
    throw new Error(`round_not_found: ${roundId}`);
  }

  const round: CompetitionRound = {
    round_id: roundRow.round_id,
    starts_at: roundRow.starts_at,
    ends_at: roundRow.ends_at,
    grace_ends_at: roundRow.grace_ends_at,
    status: roundRow.status as CompetitionRound["status"],
    min_volume_usd: roundRow.min_volume_usd,
    min_priced_trade_count: roundRow.min_priced_trade_count,
    created_at: roundRow.created_at,
    finalized_at: roundRow.finalized_at,
  };

  // ── 2. Fetch frozen price snapshot ─────────────────────────────────────────
  const snapshotResult = await db
    .prepare(
      "SELECT token_id, price_usd, decimals FROM competition_round_price_snapshots WHERE round_id = ?1"
    )
    .bind(roundId)
    .all<D1PriceSnapshotRow>();

  const priceMap = new Map<string, { price_usd: number; decimals: number }>();
  for (const row of snapshotResult.results ?? []) {
    priceMap.set(row.token_id, { price_usd: row.price_usd, decimals: row.decimals });
  }

  // ── 3. Fetch eligible swap aggregates ──────────────────────────────────────
  const swapResult = await db
    .prepare(ROUND_SWAP_AGGREGATE_SQL)
    .bind(round.starts_at, round.ends_at)
    .all<D1SwapAggRow>();

  const swapRows = swapResult.results ?? [];

  // ── 4. Group swap rows by sender → AgentSwapAggregate ─────────────────────
  const agentMap = new Map<string, AgentSwapAggregate>();

  for (const row of swapRows) {
    let agg = agentMap.get(row.sender);
    if (!agg) {
      agg = {
        stx_address: row.sender,
        btc_address: row.btc_address,
        erc8004_agent_id: row.erc8004_agent_id ?? null,
        trade_count: 0,
        source_counts: { agent: 0, cron: 0, chainhook: 0 },
        token_pairs: [],
        latest_at: null,
      };
      agentMap.set(row.sender, agg);
    }

    agg.trade_count += row.cnt;

    // Accumulate source counts
    const src = row.source as "agent" | "cron" | "chainhook";
    if (src === "agent" || src === "cron" || src === "chainhook") {
      agg.source_counts[src] += row.cnt;
    }

    agg.token_pairs.push({
      token_in: row.token_in,
      token_out: row.token_out,
      sum_in: row.sum_in,
      sum_out: row.sum_out,
      cnt: row.cnt,
    });

    // latest_at: max across all groups
    if (agg.latest_at === null || row.latest_at > agg.latest_at) {
      agg.latest_at = row.latest_at;
    }
  }

  // ── 5. Compute financials per agent ───────────────────────────────────────
  interface AgentFinancials {
    agg: AgentSwapAggregate;
    volume_usd: number;
    received_usd: number;
    pnl_usd: number;
    pnl_percent: number | null;
    priced_trade_count: number;
    unpriced_trade_count: number;
    unpriced_tokens: string[];
  }

  const financials: AgentFinancials[] = [];

  for (const agg of agentMap.values()) {
    let volume_usd = 0;
    let received_usd = 0;
    let priced_trade_count = 0;
    let unpriced_trade_count = 0;
    const unpriced_token_set = new Set<string>();

    for (const pair of agg.token_pairs) {
      const priceIn = priceMap.get(pair.token_in);
      const priceOut = priceMap.get(pair.token_out);

      if (priceIn && priceOut) {
        // Both priced: contribute to financials
        const decimals_in = priceIn.decimals;
        const decimals_out = priceOut.decimals;
        const vol = (pair.sum_in / Math.pow(10, decimals_in)) * priceIn.price_usd;
        const rcv = (pair.sum_out / Math.pow(10, decimals_out)) * priceOut.price_usd;
        volume_usd += vol;
        received_usd += rcv;
        priced_trade_count += pair.cnt;
      } else {
        // At least one token missing from price snapshot
        unpriced_trade_count += pair.cnt;
        if (!priceIn) unpriced_token_set.add(pair.token_in);
        if (!priceOut) unpriced_token_set.add(pair.token_out);
      }
    }

    const pnl_usd = received_usd - volume_usd;
    // NaN guard: pnl_percent is null when volume_usd === 0
    const pnl_percent = volume_usd === 0 ? null : pnl_usd / volume_usd;

    financials.push({
      agg,
      volume_usd,
      received_usd,
      pnl_usd,
      pnl_percent,
      priced_trade_count,
      unpriced_trade_count,
      unpriced_tokens: Array.from(unpriced_token_set).sort(),
    });
  }

  // ── 6. Sort and assign ranks ───────────────────────────────────────────────
  // Primary sort: pnl_usd DESC; tiebreak: volume_usd DESC
  financials.sort((a, b) => {
    const pnlDiff = b.pnl_usd - a.pnl_usd;
    if (pnlDiff !== 0) return pnlDiff;
    return b.volume_usd - a.volume_usd;
  });

  // ── 7. Build RoundResult rows ──────────────────────────────────────────────
  const results: RoundResult[] = financials.map((f, idx) => {
    const resultJson: ResultJson = {
      source_counts: f.agg.source_counts,
      unpriced_tokens: f.unpriced_tokens,
    };

    return {
      round_id: roundId,
      rank: idx + 1,
      stx_address: f.agg.stx_address,
      btc_address: f.agg.btc_address,
      erc8004_agent_id: f.agg.erc8004_agent_id,
      trade_count: f.agg.trade_count,
      priced_trade_count: f.priced_trade_count,
      unpriced_trade_count: f.unpriced_trade_count,
      volume_usd: f.volume_usd,
      received_usd: f.received_usd,
      pnl_usd: f.pnl_usd,
      pnl_percent: f.pnl_percent,
      latest_trade_at: f.agg.latest_at,
      result_json: resultJson,
      calculated_at: calculatedAt,
    };
  });

  // ── 8. Determine reward winners ────────────────────────────────────────────
  const rewards: CompetitionReward[] = [];

  function buildReward(
    category: RewardCategory,
    winner: AgentFinancials
  ): CompetitionReward {
    return {
      round_id: roundId,
      category,
      rank: 1,
      stx_address: winner.agg.stx_address,
      erc8004_agent_id: winner.agg.erc8004_agent_id,
      amount_sats: 0,
      status: "pending",
      payout_txid: null,
      paid_at: null,
      notes: null,
      created_at: calculatedAt,
    };
  }

  // overall_pnl: rank 1 (already sorted by pnl_usd DESC)
  if (financials.length > 0) {
    rewards.push(buildReward("overall_pnl", financials[0]));
  }

  // volume: highest volume_usd
  if (financials.length > 0) {
    const volumeSorted = [...financials].sort((a, b) => b.volume_usd - a.volume_usd);
    rewards.push(buildReward("volume", volumeSorted[0]));
  }

  // return: highest pnl_percent among floor-qualified agents
  const returnCandidates = financials.filter(
    (f) =>
      f.pnl_percent !== null &&
      f.volume_usd >= round.min_volume_usd &&
      f.priced_trade_count >= round.min_priced_trade_count
  );
  if (returnCandidates.length > 0) {
    // Sort by pnl_percent DESC; tiebreak volume_usd DESC
    returnCandidates.sort((a, b) => {
      const pctDiff = (b.pnl_percent as number) - (a.pnl_percent as number);
      if (pctDiff !== 0) return pctDiff;
      return b.volume_usd - a.volume_usd;
    });
    rewards.push(buildReward("return", returnCandidates[0]));
  }

  return { results, rewards };
}
