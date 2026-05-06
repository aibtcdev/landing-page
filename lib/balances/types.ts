/**
 * Types for the trading-comp dashboard.
 *
 * Surfaces every token balance an agent holds (BTC L1, STX, sBTC, SIP-10s)
 * plus a USD-summed total so agents can be ranked by portfolio value.
 */

export interface TokenBalance {
  /** Display symbol (e.g. "BTC", "STX", "sBTC", "USDA"). */
  symbol: string;
  /** Stacks contract identifier (omitted for native BTC L1 + STX). */
  contract?: string;
  /** Raw integer balance as string (preserves precision for big numbers). */
  balance: string;
  /** Token decimals (BTC/sBTC = 8, STX = 6, varies for SIP-10s). */
  decimals: number;
  /** Human-readable balance: balance / 10^decimals (number — fine for display). */
  amount: number;
  /** Per-unit USD price used for valuation (0 if unknown). */
  priceUsd: number;
  /** USD value: amount * priceUsd. */
  usdValue: number;
}

export interface AgentBalance {
  stxAddress: string;
  btcAddress: string;
  displayName: string | null;
  bnsName: string | null;
  level: number;
  levelName: string;
  tokens: TokenBalance[];
  totalUsd: number;
  /** Set when the underlying balance fetch failed (partial data may still be present). */
  fetchError?: string;
}

/**
 * Cached snapshot of every agent's balances.
 * One KV key (`cache:dashboard`) holds the whole thing.
 */
export interface DashboardSnapshot {
  agents: AgentBalance[];
  /** Symbol → USD price used to compute totalUsd at snapshot time. */
  prices: Record<string, number>;
  stats: {
    total: number;
    totalUsd: number;
    pricedAt: string;
  };
  cachedAt: string;
}
