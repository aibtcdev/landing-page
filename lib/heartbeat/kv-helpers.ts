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
export async function updateCheckInRecord(
  kv: KVNamespace,
  btcAddress: string,
  timestamp: string,
  existing?: CheckInRecord | null
): Promise<CheckInRecord> {
  const current = existing !== undefined ? existing : await getCheckInRecord(kv, btcAddress);

  const record: CheckInRecord = current
    ? {
        btcAddress,
        checkInCount: current.checkInCount + 1,
        lastCheckInAt: timestamp,
      }
    : {
        btcAddress,
        checkInCount: 1,
        lastCheckInAt: timestamp,
      };

  const key = `${CHECK_IN_PREFIX}${btcAddress}`;
  await kv.put(key, JSON.stringify(record));

  return record;
}
