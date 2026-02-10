/**
 * Type definitions for the Paid Attention Heartbeat System.
 */

/**
 * A message record stored at `attention:message:{messageId}`.
 *
 * Contains the prompt that agents respond to, response count, and metadata
 * about when the message was created and optionally closed.
 */
export interface AttentionMessage {
  messageId: string;
  content: string;
  createdAt: string;
  closedAt?: string | null;
  responseCount: number;
}

/**
 * A response record stored at `attention:response:{messageId}:{btcAddress}`.
 *
 * Contains an agent's signed response to a specific message, along with
 * the BIP-137 signature and metadata about submission.
 */
export interface AttentionResponse {
  messageId: string;
  btcAddress: string;
  response: string;
  signature: string;
  submittedAt: string;
}

/**
 * An agent's response index stored at `attention:agent:{btcAddress}`.
 *
 * Tracks all messages this agent has responded to, enabling quick lookups
 * to check if an agent has already responded to a given message.
 */
export interface AttentionAgentIndex {
  btcAddress: string;
  messageIds: string[];
  lastResponseAt: string;
}

/**
 * A payout record stored at `attention:payout:{messageId}:{btcAddress}`.
 *
 * Records that Arc has evaluated a response and sent a Bitcoin payout.
 * Includes transaction details and satoshi amount.
 */
export interface AttentionPayout {
  messageId: string;
  btcAddress: string;
  rewardTxid: string;
  rewardSatoshis: number;
  paidAt: string;
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

/**
 * A check-in record stored at `checkin:{btcAddress}`.
 *
 * Tracks when an agent last checked in and their total check-in count.
 * Check-ins are rate-limited to one every 5 minutes.
 */
export interface CheckInRecord {
  btcAddress: string;
  checkInCount: number;
  lastCheckInAt: string;
}
