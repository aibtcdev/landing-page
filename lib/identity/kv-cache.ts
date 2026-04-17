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
 *
 * All public functions accept an optional {@link Logger}. When provided, cache
 * hit/miss telemetry and KV/parse errors are emitted through that logger (and
 * on to worker-logs). When omitted, the helpers are silent — we do NOT fall
 * back to `console.*`, which would bypass worker-logs.
 */

import type { AgentIdentity } from "./types";
import type { Logger } from "../logging";

// Cache TTLs in seconds
const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours
const BNS_NEGATIVE_CACHE_TTL = 60 * 60; // 1 hour for addresses with no BNS name
const IDENTITY_CACHE_TTL = 24 * 60 * 60; // 24 hours (immutable NFT — raised from 6h)
const IDENTITY_NEGATIVE_CACHE_TTL = 5 * 60; // 5 minutes for addresses with no identity
const STACKING_CACHE_TTL = 4 * 60 * 60; // 4 hours (PoX cycle is ~2 weeks)
const REPUTATION_CACHE_TTL = 60 * 60; // 1 hour (raised from 5 minutes)
const TX_CACHE_TTL = 30 * 60; // 30 minutes (raised from 5 minutes)

/** Result from a cache lookup: distinguishes miss ({hit:false}) from cached null ({hit:true,value:null}). */
export type CacheResult<T> = { hit: true; value: T | null } | { hit: false };

/** Sentinel value for negative cache entries (address has no BNS name or on-chain identity). */
export const NONE_SENTINEL = "__NONE__";

/** @deprecated Use NONE_SENTINEL instead. */
export const BNS_NONE_SENTINEL = NONE_SENTINEL;

/** Safely read a string value from KV, returning null on miss or error. */
async function kvGet(
  kv: KVNamespace | undefined,
  key: string,
  keyFamily: string,
  logger?: Logger
): Promise<string | null> {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (error) {
    logger?.error("cache.kv_read_error", {
      keyFamily,
      key,
      error: String(error),
    });
    return null;
  }
}

/** Safely write a value to KV with TTL, ignoring errors. */
async function kvPut(
  kv: KVNamespace | undefined,
  key: string,
  value: string,
  ttl: number,
  keyFamily: string,
  logger?: Logger
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, value, { expirationTtl: ttl });
  } catch (error) {
    logger?.error("cache.kv_write_error", {
      keyFamily,
      key,
      error: String(error),
    });
  }
}

/**
 * Emit a structured cache-hit/miss telemetry event via the logger.
 * No-op when logger is undefined (callers that don't thread a logger
 * simply skip telemetry rather than falling back to console).
 */
function logCacheEvent(
  logger: Logger | undefined,
  event: "cache.hit" | "cache.miss",
  keyFamily: string,
  key: string,
  negative = false
): void {
  if (!logger) return;
  const payload: Record<string, unknown> = { keyFamily, key };
  if (negative) payload.negative = true;
  logger.info(event, payload);
}

/**
 * Read and JSON-parse a cached value, emitting telemetry on hit/miss.
 * Returns the parsed value, or null on miss / parse failure. Used by caches
 * that don't need to distinguish "missing" from "cached null" (e.g. the
 * transaction and stacking caches).
 */
async function readJsonCache<T>(
  kv: KVNamespace | undefined,
  prefix: string,
  keyFamily: string,
  key: string,
  logger?: Logger
): Promise<T | null> {
  const raw = await kvGet(kv, `${prefix}${key}`, keyFamily, logger);
  if (!raw) {
    logCacheEvent(logger, "cache.miss", keyFamily, key);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as T;
    logCacheEvent(logger, "cache.hit", keyFamily, key);
    return parsed;
  } catch (error) {
    logger?.error("cache.parse_error", {
      keyFamily,
      key,
      error: String(error),
    });
    return null;
  }
}

/**
 * Read a cache entry that uses NONE_SENTINEL to distinguish negative hits
 * from misses. Returns a CacheResult so callers can tell apart "never cached"
 * from "cached as null".
 */
async function readSentinelCache<T>(
  kv: KVNamespace | undefined,
  prefix: string,
  keyFamily: string,
  key: string,
  logger?: Logger
): Promise<CacheResult<T>> {
  const raw = await kvGet(kv, `${prefix}${key}`, keyFamily, logger);
  if (raw === null) {
    logCacheEvent(logger, "cache.miss", keyFamily, key);
    return { hit: false };
  }
  if (raw === NONE_SENTINEL) {
    logCacheEvent(logger, "cache.hit", keyFamily, key, true);
    return { hit: true, value: null };
  }
  try {
    const parsed = JSON.parse(raw) as T;
    logCacheEvent(logger, "cache.hit", keyFamily, key);
    return { hit: true, value: parsed };
  } catch (error) {
    logger?.error("cache.parse_error", {
      keyFamily,
      key,
      error: String(error),
    });
    return { hit: false };
  }
}

export async function getCachedBnsName(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<string | null> {
  // BNS uses a raw string (name) rather than JSON, so we call kvGet directly
  // and emit telemetry here for parity with the other caches.
  const raw = await kvGet(kv, `cache:bns:${address}`, "bns", logger);
  if (raw === null) {
    logCacheEvent(logger, "cache.miss", "bns", address);
    return null;
  }
  logCacheEvent(logger, "cache.hit", "bns", address, raw === NONE_SENTINEL);
  return raw;
}

export function setCachedBnsName(
  address: string,
  name: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(kv, `cache:bns:${address}`, name, BNS_CACHE_TTL, "bns", logger);
}

export function setCachedBnsNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:bns:${address}`,
    NONE_SENTINEL,
    BNS_NEGATIVE_CACHE_TTL,
    "bns",
    logger
  );
}

export function getCachedIdentity(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<CacheResult<AgentIdentity>> {
  return readSentinelCache<AgentIdentity>(
    kv,
    "cache:identity:",
    "identity",
    address,
    logger
  );
}

export function setCachedIdentity(
  address: string,
  identity: AgentIdentity,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:identity:${address}`,
    JSON.stringify(identity),
    IDENTITY_CACHE_TTL,
    "identity",
    logger
  );
}

export function setCachedIdentityNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:identity:${address}`,
    NONE_SENTINEL,
    IDENTITY_NEGATIVE_CACHE_TTL,
    "identity",
    logger
  );
}

export function getCachedReputation<T>(
  key: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<CacheResult<T>> {
  return readSentinelCache<T>(
    kv,
    "cache:reputation:",
    "reputation",
    key,
    logger
  );
}

export function setCachedReputation(
  key: string,
  data: unknown,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:reputation:${key}`,
    JSON.stringify(data),
    REPUTATION_CACHE_TTL,
    "reputation",
    logger
  );
}

export function getCachedTransaction(
  txid: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<any | null> {
  return readJsonCache<any>(kv, "cache:tx:", "tx", txid, logger);
}

export function setCachedTransaction(
  txid: string,
  data: any,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:tx:${txid}`,
    JSON.stringify(data),
    TX_CACHE_TTL,
    "tx",
    logger
  );
}

/** Minimal shape of a Hiro stacking response used by the stacker achievement. */
export interface StackingCacheEntry {
  locked: string;
}

export function getCachedStacking(
  stxAddress: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<StackingCacheEntry | null> {
  return readJsonCache<StackingCacheEntry>(
    kv,
    "cache:stacking:",
    "stacking",
    stxAddress,
    logger
  );
}

export function setCachedStacking(
  stxAddress: string,
  data: StackingCacheEntry,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:stacking:${stxAddress}`,
    JSON.stringify(data),
    STACKING_CACHE_TTL,
    "stacking",
    logger
  );
}
