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

/**
 * Partial agent record for auto-registration during first response.
 *
 * When an unregistered agent submits a response, we create this minimal
 * record with only Bitcoin credentials. Agents can later complete their
 * registration via /api/register to add Stacks credentials and unlock
 * additional features.
 */
export interface PartialAgentRecord {
  btcAddress: string;
  btcPublicKey: string;
  displayName?: string;
  verifiedAt: string;
  lastActiveAt?: string;
  checkInCount?: number;
  stxAddress?: never;
  stxPublicKey?: never;
  description?: never;
  bnsName?: never;
  owner?: never;
}

/**
 * Type guard to check if an agent record is a partial registration.
 *
 * Partial records only have Bitcoin credentials (no stxAddress).
 * Full records have both Bitcoin and Stacks credentials.
 */
export function isPartialAgentRecord(
  agent: unknown
): agent is PartialAgentRecord {
  if (!agent || typeof agent !== "object") return false;
  const record = agent as Record<string, unknown>;
  const hasStacksCredentials =
    typeof record.stxAddress === "string" ||
    typeof record.stxPublicKey === "string";
  return (
    typeof record.btcAddress === "string" &&
    typeof record.btcPublicKey === "string" &&
    !hasStacksCredentials &&
    typeof record.verifiedAt === "string"
  );
}
