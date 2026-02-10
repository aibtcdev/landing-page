/**
 * Constants for the Achievement System.
 */

/**
 * KV key prefixes for all achievement system data.
 *
 * All records use prefix-based keys to enable efficient listing and
 * namespace separation from other platform data.
 */
export const KV_PREFIXES = {
  /**
   * Individual achievement unlock records.
   * Key: "achievement:{btcAddress}:{achievementId}"
   * Value: AchievementRecord
   */
  ACHIEVEMENT: "achievement:",

  /**
   * Per-agent achievement index.
   * Key: "achievements:{btcAddress}"
   * Value: AchievementAgentIndex
   */
  ACHIEVEMENTS_INDEX: "achievements:",
} as const;
