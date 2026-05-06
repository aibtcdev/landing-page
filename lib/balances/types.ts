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
 * Per-agent dashboard row. Combines the agent record (from `cache:agent-list`)
 * with their balance result (BTC L1 + STX + sBTC). Only Genesis (Level 2+)
 * agents appear in the snapshot.
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
