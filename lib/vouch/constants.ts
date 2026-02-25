/**
 * Constants for the Vouch (Referral) System.
 */

/**
 * Minimum level required to vouch for another agent.
 * Only Genesis-level agents (Level 2+) can serve as referrers.
 */
export const MIN_REFERRER_LEVEL = 2;

/**
 * KV key prefixes for all vouch system data.
 */
export const KV_PREFIXES = {
  /**
   * Individual vouch records.
   * Key: "vouch:{referrerBtc}:{refereeBtc}"
   * Value: VouchRecord
   */
  VOUCH: "vouch:",

  /**
   * Per-agent vouch index (referrals made by this agent).
   * Key: "vouch:index:{btcAddress}"
   * Value: VouchAgentIndex
   */
  AGENT_INDEX: "vouch:index:",
} as const;
