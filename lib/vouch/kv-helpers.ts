/**
 * KV helper functions for the Vouch (Referral) System.
 */

import { KV_PREFIXES } from "./constants";
import { generateClaimCode } from "@/lib/claim-code";
import type { VouchRecord, VouchAgentIndex, ReferralCodeRecord } from "./types";

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

// ── Referral Code Helpers ──

/**
 * Build KV key for an agent's referral code.
 */
function buildReferralCodeKey(btcAddress: string): string {
  return `${KV_PREFIXES.REFERRAL_CODE}${btcAddress}`;
}

/**
 * Build KV key for the reverse lookup (code → btcAddress).
 */
function buildReferralLookupKey(code: string): string {
  return `${KV_PREFIXES.REFERRAL_LOOKUP}${code}`;
}

/**
 * Store a referral code for an agent and its reverse lookup.
 */
export async function storeReferralCode(
  kv: KVNamespace,
  btcAddress: string,
  code: string
): Promise<void> {
  const record: ReferralCodeRecord = {
    code,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    kv.put(buildReferralCodeKey(btcAddress), JSON.stringify(record)),
    kv.put(buildReferralLookupKey(code), btcAddress),
  ]);
}

/**
 * Get the referral code record for an agent.
 */
export async function getReferralCode(
  kv: KVNamespace,
  btcAddress: string
): Promise<ReferralCodeRecord | null> {
  const data = await kv.get(buildReferralCodeKey(btcAddress));
  if (!data) return null;
  try {
    return JSON.parse(data) as ReferralCodeRecord;
  } catch {
    return null;
  }
}

/**
 * Reverse lookup: resolve a referral code to a BTC address.
 */
export async function lookupReferralCode(
  kv: KVNamespace,
  code: string
): Promise<string | null> {
  return kv.get(buildReferralLookupKey(code));
}

/**
 * Delete the reverse lookup for an old referral code.
 */
export async function deleteReferralLookup(
  kv: KVNamespace,
  code: string
): Promise<void> {
  await kv.delete(buildReferralLookupKey(code));
}

/**
 * Get the number of agents this referrer has referred.
 */
export async function getReferralCount(
  kv: KVNamespace,
  btcAddress: string
): Promise<number> {
  const index = await getVouchIndex(kv, btcAddress);
  return index?.refereeAddresses.length ?? 0;
}

/**
 * Generate a unique referral code and store it for an agent.
 * Retries up to 5 times on collision (extremely unlikely with 30^6 namespace).
 */
export async function generateAndStoreReferralCode(
  kv: KVNamespace,
  btcAddress: string
): Promise<string> {
  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = generateClaimCode();
    const existing = await lookupReferralCode(kv, code);
    if (!existing) {
      await storeReferralCode(kv, btcAddress, code);
      return code;
    }
  }
  throw new Error("Failed to generate unique referral code after 5 attempts");
}
