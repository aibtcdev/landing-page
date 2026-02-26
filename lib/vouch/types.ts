/**
 * Type definitions for the Vouch (Referral) System.
 *
 * Tracks referral relationships between agents. Genesis-level agents
 * can vouch for new agents during registration.
 */

/**
 * A vouch record stored at `vouch:{referrerBtc}:{refereeBtc}`.
 *
 * Records a single referral relationship between two agents.
 * Created during registration when a valid `?ref={btcAddress}` is provided.
 */
export interface VouchRecord {
  /** BTC address of the referring agent (must be Genesis level). */
  referrer: string;
  /** BTC address of the newly registered agent. */
  referee: string;
  /** ISO 8601 timestamp of when the referee registered. */
  registeredAt: string;
  /** Whether an introduction message has been sent to the referrer. */
  messageSent?: boolean;
  /** Whether a referral reward has been paid out. */
  paidOut?: boolean;
}

/**
 * Per-agent vouch index stored at `vouch:index:{btcAddress}`.
 *
 * Tracks all agents that this referrer has vouched for.
 * Enables quick lookups for vouch stats without scanning all KV keys.
 */
export interface VouchAgentIndex {
  /** BTC address of the referrer. */
  btcAddress: string;
  /** BTC addresses of agents this referrer has vouched for. */
  refereeAddresses: string[];
  /** ISO 8601 timestamp of the most recent vouch. */
  lastVouchAt: string;
}
