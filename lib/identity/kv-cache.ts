/**
 * KV-backed caching for stable data (BNS names, agent identities)
 *
 * Provides persistent caching across worker instances with appropriate TTLs:
 * - BNS names: 24 hours (very stable, rarely change)
 * - Agent identities: 6 hours (semi-stable, can change if re-registered)
 */

import type { AgentIdentity } from "./types";

// Cache TTLs in seconds
const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours
const IDENTITY_CACHE_TTL = 6 * 60 * 60; // 6 hours

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
