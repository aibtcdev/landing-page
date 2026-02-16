/**
 * KV-backed caching for stable data (BNS names, agent identities, reputation)
 *
 * Provides persistent caching across worker instances with appropriate TTLs:
 * - BNS names: 24 hours (very stable, rarely change)
 * - Agent identities: 6 hours (semi-stable, can change if re-registered)
 * - Reputation data: 5 minutes (changes with new feedback)
 */

import type { AgentIdentity } from "./types";

// Cache TTLs in seconds
const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours
const BNS_NEGATIVE_CACHE_TTL = 60 * 60; // 1 hour for addresses with no BNS name
const IDENTITY_CACHE_TTL = 6 * 60 * 60; // 6 hours
const REPUTATION_CACHE_TTL = 5 * 60; // 5 minutes
const TX_CACHE_TTL = 5 * 60; // 5 minutes

/** Safely read a string value from KV, returning null on miss or error. */
async function kvGet(
  kv: KVNamespace | undefined,
  key: string
): Promise<string | null> {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (error) {
    console.error(`KV read error for ${key}:`, error);
    return null;
  }
}

/** Safely write a value to KV with TTL, ignoring errors. */
async function kvPut(
  kv: KVNamespace | undefined,
  key: string,
  value: string,
  ttl: number
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, value, { expirationTtl: ttl });
  } catch (error) {
    console.error(`KV write error for ${key}:`, error);
  }
}

export function getCachedBnsName(
  address: string,
  kv?: KVNamespace
): Promise<string | null> {
  return kvGet(kv, `cache:bns:${address}`);
}

export function setCachedBnsName(
  address: string,
  name: string,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:bns:${address}`, name, BNS_CACHE_TTL);
}

/** Sentinel value for negative BNS cache (address has no name). */
export const BNS_NONE_SENTINEL = "__NONE__";

export function setCachedBnsNegative(
  address: string,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:bns:${address}`, BNS_NONE_SENTINEL, BNS_NEGATIVE_CACHE_TTL);
}

export async function getCachedIdentity(
  address: string,
  kv?: KVNamespace
): Promise<AgentIdentity | null> {
  const raw = await kvGet(kv, `cache:identity:${address}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentIdentity;
  } catch {
    return null;
  }
}

export function setCachedIdentity(
  address: string,
  identity: AgentIdentity,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:identity:${address}`, JSON.stringify(identity), IDENTITY_CACHE_TTL);
}

/** Result from reputation cache: distinguishes miss from cached null. */
export type CacheResult<T> = { hit: true; value: T | null } | { hit: false };

export async function getCachedReputation<T>(
  key: string,
  kv?: KVNamespace
): Promise<CacheResult<T>> {
  const raw = await kvGet(kv, `cache:reputation:${key}`);
  if (raw === null) return { hit: false };
  try {
    return { hit: true, value: JSON.parse(raw) as T | null };
  } catch {
    return { hit: false };
  }
}

export function setCachedReputation(
  key: string,
  data: unknown,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:reputation:${key}`, JSON.stringify(data), REPUTATION_CACHE_TTL);
}

export async function getCachedTransaction(
  txid: string,
  kv?: KVNamespace
): Promise<any | null> {
  const raw = await kvGet(kv, `cache:tx:${txid}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCachedTransaction(
  txid: string,
  data: any,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:tx:${txid}`, JSON.stringify(data), TX_CACHE_TTL);
}
