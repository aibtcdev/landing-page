/**
 * Shared type definitions for AIBTC agent records.
 */

export interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey: string;
  btcPublicKey: string;
  taprootAddress?: string | null;
  displayName?: string;
  description?: string | null;
  bnsName?: string | null;
  verifiedAt: string;
  owner?: string | null;
  lastActiveAt?: string;
  checkInCount?: number;
  erc8004AgentId?: number | null;
  lastIdentityCheck?: string;
  /** BTC address of the agent who vouched for this agent during registration (immutable once set). */
  referredBy?: string;
}

/**
 * Claim status record for viral tweet rewards (minimal type for level computation).
 * Used by computeLevel() to determine if an agent has reached Genesis (Level 2).
 */
export interface ClaimStatus {
  status: "pending" | "verified" | "rewarded" | "failed";
  claimedAt: string;
  rewardSatoshis?: number;
  rewardTxid?: string | null;
}

/**
 * Complete claim record stored in KV at claim:{btcAddress}.
 * Includes all fields from viral tweet submission and payout tracking.
 * Used by claim endpoints and profile pages.
 */
export interface ClaimRecord {
  btcAddress: string;
  displayName: string;
  tweetUrl: string;
  tweetAuthor: string | null;
  claimedAt: string;
  rewardSatoshis: number;
  rewardTxid: string | null;
  status: "pending" | "verified" | "rewarded" | "failed";
}
