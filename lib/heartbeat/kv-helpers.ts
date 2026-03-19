/**
 * KV helper functions for the Heartbeat system.
 */

import { CHECK_IN_PREFIX } from "./constants";
import type { CheckInRecord } from "./types";

/**
 * Fetch the check-in record for a specific Bitcoin address.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address to look up
 * @returns CheckInRecord or null if no check-in record exists
 *
 * @example
 * const checkIn = await getCheckInRecord(kv, "bc1q...");
 * if (checkIn) {
 *   console.log(`Last check-in: ${checkIn.lastCheckInAt}`);
 * }
 */
export async function getCheckInRecord(
  kv: KVNamespace,
  btcAddress: string
): Promise<CheckInRecord | null> {
  const key = `${CHECK_IN_PREFIX}${btcAddress}`;
  const data = await kv.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as CheckInRecord;
  } catch (e) {
    console.error(`Failed to parse check-in record for ${btcAddress}:`, e);
    return null;
  }
}

/**
 * Update the check-in record for a Bitcoin address.
 *
 * If no record exists, creates a new one with checkInCount = 1.
 * If a record exists, increments checkInCount and updates lastCheckInAt.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address to update
 * @param timestamp - ISO 8601 timestamp of the check-in
 * @param existing - Optional previously-fetched record to avoid a redundant KV read
 * @returns The updated CheckInRecord
 *
 * @example
 * const record = await updateCheckInRecord(kv, "bc1q...", "2026-02-10T12:00:00.000Z");
 * console.log(`Check-in count: ${record.checkInCount}`);
 */
/**
 * Compute the UTC date string (YYYY-MM-DD) from an ISO timestamp.
 */
function toDateString(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Check if two date strings represent consecutive days.
 *
 * @returns true if dateB is exactly 1 day after dateA
 */
function isConsecutiveDay(dateA: string, dateB: string): boolean {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  const diffMs = b.getTime() - a.getTime();
  return diffMs === 86_400_000;
}

export async function updateCheckInRecord(
  kv: KVNamespace,
  btcAddress: string,
  timestamp: string,
  existing?: CheckInRecord | null
): Promise<CheckInRecord> {
  const current = existing !== undefined ? existing : await getCheckInRecord(kv, btcAddress);
  const todayDate = toDateString(timestamp);

  let currentStreak: number;
  let longestStreak: number;

  if (!current) {
    // First ever check-in
    currentStreak = 1;
    longestStreak = 1;
  } else {
    const lastDate = current.lastCheckInDate;
    const prevStreak = current.currentStreak ?? 1;
    const prevLongest = current.longestStreak ?? prevStreak;

    if (lastDate === todayDate) {
      // Same day — idempotent, no streak change
      currentStreak = prevStreak;
      longestStreak = prevLongest;
    } else if (lastDate && isConsecutiveDay(lastDate, todayDate)) {
      // Consecutive day — extend streak
      currentStreak = prevStreak + 1;
      longestStreak = Math.max(prevLongest, currentStreak);
    } else {
      // Gap > 1 day — reset streak
      currentStreak = 1;
      longestStreak = prevLongest;
    }
  }

  const record: CheckInRecord = {
    btcAddress,
    checkInCount: current ? current.checkInCount + 1 : 1,
    lastCheckInAt: timestamp,
    lastCheckInDate: todayDate,
    currentStreak,
    longestStreak,
  };

  const key = `${CHECK_IN_PREFIX}${btcAddress}`;
  await kv.put(key, JSON.stringify(record));

  return record;
}
