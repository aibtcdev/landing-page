/**
 * Types for the trading-comp dashboard.
 *
 * Surfaces three native token balances per agent: BTC L1, STX, sBTC.
 * No USD valuation — raw token amounts only.
 */

export interface TokenBalance {
  /** "BTC" | "STX" | "sBTC". */
  symbol: "BTC" | "STX" | "sBTC";
  /** Raw integer balance as string (preserves precision). */
  balance: string;
  /** Token decimals (BTC = 8, STX = 6, sBTC = 8). */
  decimals: number;
  /** Human-readable balance: balance / 10^decimals. */
  amount: number;
}

/**
 * Per-agent leaderboard row. Combines the agent record (from `cache:agent-list`)
 * with their balance result (from `cache:balance:{btc}`).
 */
export interface AgentBalance {
  stxAddress: string;
  btcAddress: string;
  displayName: string | null;
  bnsName: string | null;
  level: number;
  levelName: string;
  tokens: TokenBalance[];
  /** Set when at least one upstream failed and the result is partial. */
  fetchError?: string;
}
