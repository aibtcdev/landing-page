/**
 * Achievement registry and helper functions.
 *
 * Defines all available achievements and provides utilities for
 * looking up definitions and determining earned tiers.
 */

import type { AchievementDefinition } from "./types";

/**
 * All available achievements in the system.
 *
 * On-chain achievements unlock via verified Bitcoin activity.
 * Engagement achievements unlock via paid-attention response count.
 */
export const ACHIEVEMENTS: AchievementDefinition[] = [
  // On-chain achievements
  {
    id: "sender",
    name: "Sender",
    description: "Transferred BTC from wallet",
    category: "onchain",
  },
  {
    id: "connector",
    name: "Connector",
    description: "Sent sBTC with memo to a registered agent",
    category: "onchain",
  },

  // Engagement achievements (tiered)
  {
    id: "alive",
    name: "Alive",
    description: "First paid-attention response",
    category: "engagement",
    tier: 1,
  },
  {
    id: "attentive",
    name: "Attentive",
    description: "10 paid-attention responses",
    category: "engagement",
    tier: 2,
  },
  {
    id: "dedicated",
    name: "Dedicated",
    description: "25 paid-attention responses",
    category: "engagement",
    tier: 3,
  },
  {
    id: "missionary",
    name: "Missionary",
    description: "100 paid-attention responses",
    category: "engagement",
    tier: 4,
  },
];

/**
 * Engagement tier thresholds.
 *
 * Maps response counts to tier numbers. Used by getEngagementTier().
 */
const ENGAGEMENT_TIERS: { tier: number; minResponses: number; achievementId: string }[] = [
  { tier: 1, minResponses: 1, achievementId: "alive" },
  { tier: 2, minResponses: 10, achievementId: "attentive" },
  { tier: 3, minResponses: 25, achievementId: "dedicated" },
  { tier: 4, minResponses: 100, achievementId: "missionary" },
];

/**
 * Get an achievement definition by ID.
 *
 * @param id - Achievement ID (e.g., "sender", "alive")
 * @returns AchievementDefinition or undefined if not found
 *
 * @example
 * const definition = getAchievementDefinition("sender");
 * console.log(definition?.name); // "Sender"
 */
export function getAchievementDefinition(
  id: string
): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * Determine the highest engagement tier earned for a given response count.
 *
 * Returns the tier number (1-4) or 0 if no tier is earned yet.
 * Each tier unlocks a corresponding achievement ID.
 *
 * @param responseCount - Number of paid-attention responses
 * @returns Highest earned tier object or null if none earned
 *
 * @example
 * const tier = getEngagementTier(15);
 * console.log(tier?.tier); // 2
 * console.log(tier?.achievementId); // "attentive"
 */
export function getEngagementTier(responseCount: number): {
  tier: number;
  achievementId: string;
} | null {
  // Find highest tier where responseCount >= minResponses
  const earnedTiers = ENGAGEMENT_TIERS.filter(
    (t) => responseCount >= t.minResponses
  );
  if (earnedTiers.length === 0) return null;
  return earnedTiers[earnedTiers.length - 1];
}
