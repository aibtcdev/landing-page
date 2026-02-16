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
  getAchievementCount,
  hasAchievement,
  grantAchievement,
} from "./kv";

// Verification
export {
  verifySenderAchievement,
  checkRateLimit,
  setRateLimit,
  ACHIEVEMENT_VERIFY_RATE_LIMIT_MS,
} from "./verify";

// Constants
export { KV_PREFIXES } from "./constants";
