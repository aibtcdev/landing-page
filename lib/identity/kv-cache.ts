/**
 * KV-backed caching for stable data (BNS names, agent identities, reputation)
 *
 * Provides persistent caching across worker instances with appropriate TTLs:
 * - BNS names: 24 hours positive / 1 hour negative (very stable, rarely change)
 * - Agent identities: 24 hours (immutable once minted on-chain)
 * - Identity negative cache: 5 minutes (re-check frequently for newly registered agents)
 * - Stacking status: 4 hours (changes only at PoX cycle boundaries ~2 weeks)
 * - Reputation data: 1 hour (changes slowly with new feedback)
 * - Address transactions: 30 minutes (grows over time but not hot path)
 */

import type { AgentIdentity } from "./types";

// Cache TTLs in seconds
const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours
const BNS_NEGATIVE_CACHE_TTL = 60 * 60; // 1 hour for addresses with no BNS name
const IDENTITY_CACHE_TTL = 24 * 60 * 60; // 24 hours (immutable NFT — raised from 6h)
const IDENTITY_NEGATIVE_CACHE_TTL = 5 * 60; // 5 minutes for addresses with no identity
const STACKING_CACHE_TTL = 4 * 60 * 60; // 4 hours (PoX cycle is ~2 weeks)
const REPUTATION_CACHE_TTL = 60 * 60; // 1 hour (raised from 5 minutes)
const TX_CACHE_TTL = 30 * 60; // 30 minutes (raised from 5 minutes)

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

/** Result from a cache lookup: distinguishes miss ({hit:false}) from cached null ({hit:true,value:null}). */
export type CacheResult<T> = { hit: true; value: T | null } | { hit: false };

/** Sentinel value for negative cache entries (address has no BNS name or on-chain identity). */
export const NONE_SENTINEL = "__NONE__";

/** @deprecated Use NONE_SENTINEL instead. */
export const BNS_NONE_SENTINEL = NONE_SENTINEL;


export function setCachedBnsNegative(
  address: string,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:bns:${address}`, NONE_SENTINEL, BNS_NEGATIVE_CACHE_TTL);
}

export async function getCachedIdentity(
  address: string,
  kv?: KVNamespace
): Promise<CacheResult<AgentIdentity>> {
  const raw = await kvGet(kv, `cache:identity:${address}`);
  if (raw === null) {
    console.log(JSON.stringify({ event: "cache_miss", keyFamily: "identity", key: address }));
    return { hit: false };
  }
  if (raw === NONE_SENTINEL) {
    console.log(JSON.stringify({ event: "cache_hit", keyFamily: "identity", key: address, negative: true }));
    return { hit: true, value: null };
  }
  try {
    console.log(JSON.stringify({ event: "cache_hit", keyFamily: "identity", key: address }));
    return { hit: true, value: JSON.parse(raw) as AgentIdentity };
  } catch (e) {
    console.error(`Failed to parse cached identity for ${address}:`, e);
    return { hit: false };
  }
}

export function setCachedIdentity(
  address: string,
  identity: AgentIdentity,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:identity:${address}`, JSON.stringify(identity), IDENTITY_CACHE_TTL);
}

export function setCachedIdentityNegative(
  address: string,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:identity:${address}`, NONE_SENTINEL, IDENTITY_NEGATIVE_CACHE_TTL);
}

export async function getCachedReputation<T>(
  key: string,
  kv?: KVNamespace
): Promise<CacheResult<T>> {
  const raw = await kvGet(kv, `cache:reputation:${key}`);
  if (raw === null) {
    console.log(JSON.stringify({ event: "cache_miss", keyFamily: "reputation", key }));
    return { hit: false };
  }
  try {
    console.log(JSON.stringify({ event: "cache_hit", keyFamily: "reputation", key }));
    return { hit: true, value: JSON.parse(raw) as T | null };
  } catch (e) {
    console.error(`Failed to parse cached reputation for key ${key}:`, e);
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
  if (!raw) {
    console.log(JSON.stringify({ event: "cache_miss", keyFamily: "tx", key: txid }));
    return null;
  }
  try {
    console.log(JSON.stringify({ event: "cache_hit", keyFamily: "tx", key: txid }));
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse cached transaction ${txid}:`, e);
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

export async function getCachedStacking(
  stxAddress: string,
  kv?: KVNamespace
): Promise<any | null> {
  const raw = await kvGet(kv, `cache:stacking:${stxAddress}`);
  if (!raw) {
    console.log(JSON.stringify({ event: "cache_miss", keyFamily: "stacking", key: stxAddress }));
    return null;
  }
  try {
    console.log(JSON.stringify({ event: "cache_hit", keyFamily: "stacking", key: stxAddress }));
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse cached stacking data for ${stxAddress}:`, e);
    return null;
  }
}

export function setCachedStacking(
  stxAddress: string,
  data: any,
  kv?: KVNamespace
): Promise<void> {
  return kvPut(kv, `cache:stacking:${stxAddress}`, JSON.stringify(data), STACKING_CACHE_TTL);
}
