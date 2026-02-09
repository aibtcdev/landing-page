/**
 * Shared KV helper functions for the Paid Attention system.
 */

import { KV_PREFIXES } from "./constants";
import type { AttentionMessage } from "./types";

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
  return JSON.parse(data) as AttentionMessage;
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
