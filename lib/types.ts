/**
 * Shared type definitions for AIBTC agent records.
 */

export interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey: string;
  btcPublicKey: string;
  displayName?: string;
  description?: string | null;
  bnsName?: string | null;
  verifiedAt: string;
  owner?: string | null;
  lastActiveAt?: string;
  checkInCount?: number;
  erc8004AgentId?: number | null;
  lastIdentityCheck?: string;
}

/**
 * Claim status record for viral tweet rewards.
 * Stored in KV at claim:{btcAddress}.
 * Used for level computation — agents with "verified" or "rewarded" status reach Genesis (Level 2).
 */
export interface ClaimStatus {
  status: "pending" | "verified" | "rewarded" | "failed";
  claimedAt: string;
  rewardSatoshis?: number;
  rewardTxid?: string | null;
}
