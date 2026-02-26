/**
 * KV helper functions for the Vouch (Referral) System.
 */

import { KV_PREFIXES } from "./constants";
import type { VouchRecord, VouchAgentIndex } from "./types";

/**
 * Build KV key for a vouch record.
 */
function buildVouchKey(referrerBtc: string, refereeBtc: string): string {
  return `${KV_PREFIXES.VOUCH}${referrerBtc}:${refereeBtc}`;
}

/**
 * Build KV key for the referrer's vouch index.
 */
function buildAgentIndexKey(btcAddress: string): string {
  return `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;
}

/**
 * Get a vouch record by referrer and referee addresses.
 */
export async function getVouchRecord(
  kv: KVNamespace,
  referrerBtc: string,
  refereeBtc: string
): Promise<VouchRecord | null> {
  const key = buildVouchKey(referrerBtc, refereeBtc);
  const data = await kv.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as VouchRecord;
  } catch (e) {
    console.error(`Failed to parse vouch record ${key}:`, e);
    return null;
  }
}

/**
 * Store a vouch record and update the referrer's index.
 *
 * NOTE: Known race condition — this is a read-modify-write without CAS.
 * Concurrent vouches for the same referrer can lose index updates. KV does not
 * support atomic compare-and-swap. Acceptable for now given low concurrency;
 * if drift becomes noticeable, serialize via Durable Objects.
 */
export async function storeVouch(
  kv: KVNamespace,
  record: VouchRecord
): Promise<void> {
  const vouchKey = buildVouchKey(record.referrer, record.referee);
  const indexKey = buildAgentIndexKey(record.referrer);

  const existing = await getVouchIndex(kv, record.referrer);
  let index: VouchAgentIndex;

  if (existing) {
    if (!existing.refereeAddresses.includes(record.referee)) {
      existing.refereeAddresses.push(record.referee);
    }
    existing.lastVouchAt = record.registeredAt;
    index = existing;
  } else {
    index = {
      btcAddress: record.referrer,
      refereeAddresses: [record.referee],
      lastVouchAt: record.registeredAt,
    };
  }

  await Promise.all([
    kv.put(vouchKey, JSON.stringify(record)),
    kv.put(indexKey, JSON.stringify(index)),
  ]);
}

/**
 * Get the vouch index for a referrer (agents they've vouched for).
 */
export async function getVouchIndex(
  kv: KVNamespace,
  btcAddress: string
): Promise<VouchAgentIndex | null> {
  const key = buildAgentIndexKey(btcAddress);
  const data = await kv.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as VouchAgentIndex;
  } catch (e) {
    console.error(`Failed to parse vouch index ${key}:`, e);
    return null;
  }
}

/**
 * Get all vouch records for a referrer by looking up their index
 * and fetching each record.
 */
export async function getVouchRecordsByReferrer(
  kv: KVNamespace,
  referrerBtc: string
): Promise<VouchRecord[]> {
  const index = await getVouchIndex(kv, referrerBtc);
  if (!index || index.refereeAddresses.length === 0) return [];

  const records = await Promise.all(
    index.refereeAddresses.map((refereeBtc) =>
      getVouchRecord(kv, referrerBtc, refereeBtc)
    )
  );

  return records.filter((r): r is VouchRecord => r !== null);
}
