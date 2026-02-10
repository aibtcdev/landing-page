/**
 * KV helper functions for the Achievement System.
 */

import { KV_PREFIXES } from "./constants";
import type {
  AchievementRecord,
  AchievementAgentIndex,
} from "./types";

/**
 * Build KV key for an individual achievement record.
 *
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 * @returns KV key: "achievement:{btcAddress}:{achievementId}"
 */
function buildAchievementKey(btcAddress: string, achievementId: string): string {
  return `${KV_PREFIXES.ACHIEVEMENT}${btcAddress}:${achievementId}`;
}

/**
 * Build KV key for agent achievement index.
 *
 * @param btcAddress - Bitcoin address
 * @returns KV key: "achievements:{btcAddress}"
 */
function buildIndexKey(btcAddress: string): string {
  return `${KV_PREFIXES.ACHIEVEMENTS_INDEX}${btcAddress}`;
}

/**
 * Get all achievements unlocked by an agent.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @returns Array of AchievementRecords (empty if none found)
 *
 * @example
 * const achievements = await getAgentAchievements(kv, "bc1q...");
 * console.log(`Agent has ${achievements.length} achievements`);
 */
export async function getAgentAchievements(
  kv: KVNamespace,
  btcAddress: string
): Promise<AchievementRecord[]> {
  // Get index to find all achievement IDs
  const index = await getAgentIndex(kv, btcAddress);
  if (!index || index.achievementIds.length === 0) {
    return [];
  }

  // Fetch all achievement records
  const records = await Promise.all(
    index.achievementIds.map((id) => getAchievementRecord(kv, btcAddress, id))
  );

  // Filter out nulls and return
  return records.filter((r): r is AchievementRecord => r !== null);
}

/**
 * Get a specific achievement record for an agent.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 * @returns AchievementRecord or null if not found
 *
 * @example
 * const record = await getAchievementRecord(kv, "bc1q...", "sender");
 * if (record) {
 *   console.log(`Unlocked at: ${record.unlockedAt}`);
 * }
 */
export async function getAchievementRecord(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string
): Promise<AchievementRecord | null> {
  const key = buildAchievementKey(btcAddress, achievementId);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as AchievementRecord;
  } catch (e) {
    console.error(`Failed to parse achievement record ${key}:`, e);
    return null;
  }
}

/**
 * Check if an agent has unlocked a specific achievement.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 * @returns true if the agent has this achievement, false otherwise
 *
 * @example
 * const hasSender = await hasAchievement(kv, "bc1q...", "sender");
 * if (hasSender) {
 *   console.log("Agent is a sender!");
 * }
 */
export async function hasAchievement(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string
): Promise<boolean> {
  const index = await getAgentIndex(kv, btcAddress);
  if (!index) return false;
  return index.achievementIds.includes(achievementId);
}

/**
 * Grant an achievement to an agent.
 *
 * Writes both the individual achievement record and updates the agent's
 * achievement index. This is idempotent — granting the same achievement
 * twice will not create duplicates.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 * @param metadata - Optional metadata (e.g., { txid, responseCount })
 * @returns The created/updated AchievementRecord
 *
 * @example
 * const record = await grantAchievement(kv, "bc1q...", "sender", {
 *   txid: "abc123...",
 * });
 * console.log(`Achievement granted at: ${record.unlockedAt}`);
 */
export async function grantAchievement(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string,
  metadata?: Record<string, unknown>
): Promise<AchievementRecord> {
  const now = new Date().toISOString();

  // Check if already exists
  const existing = await getAchievementRecord(kv, btcAddress, achievementId);
  if (existing) {
    return existing; // Already granted, return existing record
  }

  // Create achievement record
  const record: AchievementRecord = {
    achievementId,
    btcAddress,
    unlockedAt: now,
    metadata,
  };

  // Write achievement record
  const recordKey = buildAchievementKey(btcAddress, achievementId);
  await kv.put(recordKey, JSON.stringify(record));

  // Update agent index
  await updateAgentIndex(kv, btcAddress, achievementId, now);

  return record;
}

/**
 * Get the agent achievement index.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @returns AchievementAgentIndex or null if not found
 */
async function getAgentIndex(
  kv: KVNamespace,
  btcAddress: string
): Promise<AchievementAgentIndex | null> {
  const key = buildIndexKey(btcAddress);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as AchievementAgentIndex;
  } catch (e) {
    console.error(`Failed to parse achievement index ${key}:`, e);
    return null;
  }
}

/**
 * Update the agent achievement index.
 *
 * Adds a new achievement ID to the index or creates the index if it doesn't exist.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID to add
 * @param timestamp - ISO timestamp for lastUpdated
 */
async function updateAgentIndex(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string,
  timestamp: string
): Promise<void> {
  const key = buildIndexKey(btcAddress);
  const existing = await getAgentIndex(kv, btcAddress);

  let index: AchievementAgentIndex;
  if (existing) {
    // Add achievement ID if not already present
    if (!existing.achievementIds.includes(achievementId)) {
      existing.achievementIds.push(achievementId);
    }
    existing.lastUpdated = timestamp;
    index = existing;
  } else {
    // Create new index
    index = {
      btcAddress,
      achievementIds: [achievementId],
      lastUpdated: timestamp,
    };
  }

  await kv.put(key, JSON.stringify(index));
}
