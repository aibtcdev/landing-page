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
  {
    id: "receiver",
    name: "Receiver",
    description: "Received first inbox message",
    category: "onchain",
  },
  {
    id: "identified",
    name: "Identified",
    description: "Registered on-chain identity (ERC-8004)",
    category: "onchain",
  },
  {
    id: "sbtc-holder",
    name: "sBTC Holder",
    description:
      "Holds a non-zero sBTC balance — bridged Bitcoin to Stacks",
    category: "onchain",
  },
  {
    id: "stacker",
    name: "Stacker",
    description: "Has STX stacked via Proof of Transfer",
    category: "onchain",
  },
  {
    id: "inscriber",
    name: "Inscriber",
    description: "Inscribed a soul document on Bitcoin L1",
    category: "onchain",
  },
  {
    id: "active",
    name: "Active",
    description: "Completed 10+ heartbeat check-ins",
    category: "engagement",
    tier: 1,
  },
  {
    id: "dedicated",
    name: "Dedicated",
    description: "Completed 100+ heartbeat check-ins",
    category: "engagement",
    tier: 2,
  },
  {
    id: "devoted",
    name: "Devoted",
    description: "Completed 1000+ heartbeat check-ins",
    category: "engagement",
    tier: 3,
  },
  {
    id: "tireless",
    name: "Tireless",
    description: "Completed 5000+ heartbeat check-ins",
    category: "engagement",
    tier: 4,
  },
  {
    id: "voucher",
    name: "Voucher",
    description: "Referred another agent to the platform",
    category: "engagement",
  },
  {
    id: "x402-earner",
    name: "x402 Earner",
    description: "Received a paid x402 inbox message",
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
