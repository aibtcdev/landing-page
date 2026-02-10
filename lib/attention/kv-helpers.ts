/**
 * Shared KV helper functions for the Paid Attention system.
 */

import { KV_PREFIXES } from "./constants";
import type { AttentionMessage, CheckInRecord } from "./types";

/**
 * Fetch the current active message from KV.
 *
 * @param kv - Cloudflare KV namespace
 * @returns The current AttentionMessage or null if no active message
 *
 * @example
 * const message = await getCurrentMessage(kv);
 * if (message) {
 *   console.log(`Active message: ${message.messageId}`);
 * }
 */
export async function getCurrentMessage(
  kv: KVNamespace
): Promise<AttentionMessage | null> {
  const data = await kv.get(KV_PREFIXES.CURRENT_MESSAGE);
  if (!data) return null;
  try {
    return JSON.parse(data) as AttentionMessage;
  } catch (e) {
    console.error("Failed to parse current attention message from KV:", e);
    return null;
  }
}

/**
 * Generic cursor-based pagination helper for KV list operations.
 *
 * Fetches all records with a given prefix, handles pagination automatically,
 * and returns an array of parsed records. Records that fail to parse are
 * logged and skipped.
 *
 * @param kv - Cloudflare KV namespace
 * @param prefix - KV key prefix to list (e.g., "attention:message:")
 * @returns Array of parsed records of type T
 *
 * @example
 * const messages = await kvListAll<AttentionMessage>(kv, KV_PREFIXES.MESSAGE);
 */
export async function kvListAll<T>(
  kv: KVNamespace,
  prefix: string
): Promise<T[]> {
  const records: T[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  // Batch size for fetching values (same as existing admin routes)
  const BATCH_SIZE = 20;

  do {
    // List keys with prefix and cursor
    const opts: KVNamespaceListOptions = { prefix };
    if (cursor) opts.cursor = cursor;
    const page = await kv.list(opts);

    // Fetch values in batches
    for (let i = 0; i < page.keys.length; i += BATCH_SIZE) {
      const batch = page.keys.slice(i, i + BATCH_SIZE);
      const batchData = await Promise.all(batch.map((key) => kv.get(key.name)));

      // Parse each record
      batchData.forEach((data, index) => {
        if (data) {
          try {
            records.push(JSON.parse(data) as T);
          } catch (e) {
            console.error(
              `Failed to parse record ${batch[index].name}:`,
              e
            );
          }
        }
      });
    }

    listComplete = page.list_complete;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (!listComplete);

  return records;
}

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
  const key = `${KV_PREFIXES.CHECK_IN}${btcAddress}`;
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
 * @returns The updated CheckInRecord
 *
 * @example
 * const record = await updateCheckInRecord(kv, "bc1q...", "2026-02-10T12:00:00.000Z");
 * console.log(`Check-in count: ${record.checkInCount}`);
 */
export async function updateCheckInRecord(
  kv: KVNamespace,
  btcAddress: string,
  timestamp: string
): Promise<CheckInRecord> {
  const existing = await getCheckInRecord(kv, btcAddress);

  const record: CheckInRecord = existing
    ? {
        btcAddress,
        checkInCount: existing.checkInCount + 1,
        lastCheckInAt: timestamp,
      }
    : {
        btcAddress,
        checkInCount: 1,
        lastCheckInAt: timestamp,
      };

  const key = `${KV_PREFIXES.CHECK_IN}${btcAddress}`;
  await kv.put(key, JSON.stringify(record));

  return record;
}
