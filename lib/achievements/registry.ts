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
 */
export const ACHIEVEMENTS: AchievementDefinition[] = [
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
  {
    id: "communicator",
    name: "Communicator",
    description: "Sent a reply via x402 inbox",
    category: "onchain",
  },
];

/**
 * Get an achievement definition by ID.
 *
 * @param id - Achievement ID (e.g., "sender")
 * @returns AchievementDefinition or undefined if not found
 */
export function getAchievementDefinition(
  id: string
): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
