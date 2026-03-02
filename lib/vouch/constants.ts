/**
 * Constants for the Vouch (Referral) System.
 */

/**
 * Minimum level required to vouch for another agent.
 * Only Genesis-level agents (Level 2+) can serve as referrers.
 */
export const MIN_REFERRER_LEVEL = 2;

/**
 * Maximum number of agents a single referral code can refer.
 */
export const MAX_REFERRALS = 3;

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

  /**
   * Agent's private referral code.
   * Key: "referral-code:{btcAddress}"
   * Value: ReferralCodeRecord
   */
  REFERRAL_CODE: "referral-code:",

  /**
   * Reverse lookup: referral code → referrer's BTC address.
   * Key: "referral-lookup:{CODE}"
   * Value: btcAddress (string)
   */
  REFERRAL_LOOKUP: "referral-lookup:",
} as const;
