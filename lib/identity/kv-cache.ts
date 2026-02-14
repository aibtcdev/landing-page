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

/**
 * Get cached BNS name for a Stacks address
 */
export async function getCachedBnsName(
  address: string,
  kv?: KVNamespace
): Promise<string | null> {
  if (!kv) return null;

  try {
    const cached = await kv.get(`cache:bns:${address}`);
    return cached;
  } catch (error) {
    console.error("Error reading BNS cache:", error);
    return null;
  }
}

/**
 * Store BNS name in cache
 */
export async function setCachedBnsName(
  address: string,
  name: string,
  kv?: KVNamespace
): Promise<void> {
  if (!kv) return;

  try {
    await kv.put(`cache:bns:${address}`, name, {
      expirationTtl: BNS_CACHE_TTL,
    });
  } catch (error) {
    console.error("Error writing BNS cache:", error);
  }
}

/**
 * Get cached agent identity
 */
export async function getCachedIdentity(
  address: string,
  kv?: KVNamespace
): Promise<AgentIdentity | null> {
  if (!kv) return null;

  try {
    const cached = await kv.get(`cache:identity:${address}`, "json");
    return cached as AgentIdentity | null;
  } catch (error) {
    console.error("Error reading identity cache:", error);
    return null;
  }
}

/**
 * Store agent identity in cache
 */
export async function setCachedIdentity(
  address: string,
  identity: AgentIdentity,
  kv?: KVNamespace
): Promise<void> {
  if (!kv) return;

  try {
    await kv.put(`cache:identity:${address}`, JSON.stringify(identity), {
      expirationTtl: IDENTITY_CACHE_TTL,
    });
  } catch (error) {
    console.error("Error writing identity cache:", error);
  }
}
