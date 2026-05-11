/**
 * P/L calculation for the trading-comp leaderboard.
 *
 * Pure functions — takes already-fetched swap rows + a price-history map,
 * produces per-trade P/L and per-agent aggregates. No I/O. The route
 * layer fetches histories (lib/competition/prices.ts) and swap rows
 * (lib/competition/d1-reads.ts) before calling this.
 *
 * Historical-price model: each trade's P/L is computed against the USD
 * price that prevailed at the trade's `burn_block_time` (looked up via
 * the OHLC bucket containing that timestamp). This is the v2 of the
 * leaderboard — Tenero exposes historical OHLC for free, so we don't
 * need to settle for "today's prices × historical amounts."
 *
 * Trades with a missing price on either leg (no OHLC candle for that
 * bucket, or the token isn't in TOKEN_DECIMALS) are EXCLUDED from the
 * pnl_usd total but still contribute to trade_count. This keeps the
 * leaderboard honest: an unpriced leg is missing data, not a real
 * economic zero. Surfacing both numbers (with + without unpriced trades)
 * lets reviewers spot when coverage matters.
 */

import { decimalsFor } from "./decimals";
import { priceAt, type PriceHistory } from "./prices";
import type { SwapRow } from "./d1-reads";

/** Lookup signature the aggregator uses for per-token price resolution. */
export type PriceHistoryMap = ReadonlyMap<string, PriceHistory | null>;

/**
 * Single-trade P/L computation. Returns null prices when either leg is
 * missing so the aggregator can skip it from the total without imputing
 * zero.
 */
export interface TradePnl {
  row: SwapRow;
  /** USD value of what the agent put in at burn_block_time. */
  inUsd: number | null;
  /** USD value of what the agent got out at burn_block_time. */
  outUsd: number | null;
  /** outUsd − inUsd. Null when either leg is unpriced. */
  pnlUsd: number | null;
}

/**
 * Convert a raw on-chain integer amount to USD given the price at that
 * timestamp and the known-decimals map. Returns null when the price is
 * null (no candle for that bucket / unknown token).
 */
function legUsd(rawAmount: number, assetId: string, priceUsd: number | null): number | null {
  if (priceUsd == null) return null;
  const decimals = decimalsFor(assetId);
  const human = rawAmount / 10 ** decimals;
  return human * priceUsd;
}

/**
 * Compute USD P/L for a single swap. Both legs use the OHLC close for
 * the bucket containing `burn_block_time` — true historical P/L.
 * Pricing for a leg may be null — see module docstring.
 */
export function computeTradePnl(
  row: SwapRow,
  histories: PriceHistoryMap
): TradePnl {
  const priceIn = priceAt(histories.get(row.token_in) ?? null, row.burn_block_time);
  const priceOut = priceAt(histories.get(row.token_out) ?? null, row.burn_block_time);
  const inUsd = legUsd(row.amount_in, row.token_in, priceIn);
  const outUsd = legUsd(row.amount_out, row.token_out, priceOut);
  const pnlUsd = inUsd != null && outUsd != null ? outUsd - inUsd : null;
  return { row, inUsd, outUsd, pnlUsd };
}

/**
 * Per-agent aggregates produced by `aggregateLeaderboard`. Sorted by
 * `pnl_usd_desc` then by `trade_count_desc` then by `first_trade_at_asc`
 * (early movers tiebreak ahead).
 */
export interface AgentScoreRow {
  sender: string;
  trade_count: number;
  /** Trades whose P/L is fully computable (both legs priced). */
  priced_trade_count: number;
  /** Trades skipped because one or both legs had no historical price. */
  unpriced_trade_count: number;
  /** Sum of priced trades' inUsd (at burn_block_time). */
  volume_in_usd: number;
  /** Sum of priced trades' outUsd (at burn_block_time). */
  volume_out_usd: number;
  /** outUsd − inUsd summed across priced trades. */
  pnl_usd: number;
  first_trade_at: number;
  last_trade_at: number;
}

/**
 * Group success swaps by sender, compute per-trade USD P/L using the
 * provided per-token price histories, and return ranked agent rows.
 *
 * Sort: pnl_usd desc → trade_count desc → first_trade_at asc.
 */
export function aggregateLeaderboard(
  rows: readonly SwapRow[],
  histories: PriceHistoryMap
): AgentScoreRow[] {
  const tradePnls = rows.map((row) => computeTradePnl(row, histories));

  const bySender = new Map<string, AgentScoreRow>();
  for (const t of tradePnls) {
    const existing = bySender.get(t.row.sender);
    if (!existing) {
      bySender.set(t.row.sender, {
        sender: t.row.sender,
        trade_count: 1,
        priced_trade_count: t.pnlUsd != null ? 1 : 0,
        unpriced_trade_count: t.pnlUsd != null ? 0 : 1,
        volume_in_usd: t.inUsd ?? 0,
        volume_out_usd: t.outUsd ?? 0,
        pnl_usd: t.pnlUsd ?? 0,
        first_trade_at: t.row.burn_block_time,
        last_trade_at: t.row.burn_block_time,
      });
      continue;
    }
    existing.trade_count++;
    if (t.pnlUsd != null) {
      existing.priced_trade_count++;
      existing.volume_in_usd += t.inUsd ?? 0;
      existing.volume_out_usd += t.outUsd ?? 0;
      existing.pnl_usd += t.pnlUsd;
    } else {
      existing.unpriced_trade_count++;
    }
    if (t.row.burn_block_time < existing.first_trade_at) {
      existing.first_trade_at = t.row.burn_block_time;
    }
    if (t.row.burn_block_time > existing.last_trade_at) {
      existing.last_trade_at = t.row.burn_block_time;
    }
  }

  return Array.from(bySender.values()).sort((a, b) => {
    if (b.pnl_usd !== a.pnl_usd) return b.pnl_usd - a.pnl_usd;
    if (b.trade_count !== a.trade_count) return b.trade_count - a.trade_count;
    return a.first_trade_at - b.first_trade_at;
  });
}
