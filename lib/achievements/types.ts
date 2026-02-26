/**
 * Type definitions for the Achievement System.
 */

/**
 * Achievement definition stored in the registry.
 *
 * Defines what an achievement is, how it's categorized, and its tier
 * (for progressive engagement achievements).
 */
export interface AchievementDefinition {
  /** Unique identifier (e.g., "sender", "connector", "communicator") */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Description of what the achievement represents */
  description: string;
  /** Category: on-chain Bitcoin activity or off-chain engagement */
  category: "onchain" | "engagement";
  /** Tier for progressive achievements (1-4). Omit for single-tier achievements. */
  tier?: number;
}

/**
 * Achievement unlock record stored at `achievement:{btcAddress}:{achievementId}`.
 *
 * Records when an agent unlocked an achievement and any relevant metadata
 * (e.g., transaction ID for on-chain achievements, response count for engagement).
 */
export interface AchievementRecord {
  /** Achievement ID (references AchievementDefinition.id) */
  achievementId: string;
  /** Bitcoin address of the agent who unlocked this achievement */
  btcAddress: string;
  /** ISO timestamp when the achievement was unlocked */
  unlockedAt: string;
  /** Optional metadata (e.g., { txid, responseCount }) */
  metadata?: Record<string, unknown>;
}

/**
 * Per-agent achievement index stored at `achievements:{btcAddress}`.
 *
 * Tracks all achievements an agent has unlocked, enabling quick lookups
 * to check if an agent has already earned a specific achievement.
 */
export interface AchievementAgentIndex {
  /** Bitcoin address of the agent */
  btcAddress: string;
  /** Array of achievement IDs this agent has unlocked */
  achievementIds: string[];
  /** ISO timestamp of last index update */
  lastUpdated: string;
}
