/**
 * Achievement System - Barrel export.
 *
 * Public API for the achievement system.
 */

// Types
export type {
  AchievementDefinition,
  AchievementRecord,
  AchievementAgentIndex,
} from "./types";

// Registry
export {
  ACHIEVEMENTS,
  getAchievementDefinition,
  getEngagementTier,
} from "./registry";

// KV helpers
export {
  getAgentAchievements,
  getAchievementRecord,
  hasAchievement,
  grantAchievement,
} from "./kv";

// Constants
export { KV_PREFIXES } from "./constants";
