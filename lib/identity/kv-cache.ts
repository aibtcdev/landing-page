/**
 * KV-backed caching for stable data (BNS names, agent identities, reputation)
 *
 * Three-state cache model for BNS/identity lookups:
 *   1. **Confirmed positive** — Hiro returned a name/identity. Cached 24h.
 *   2. **Confirmed negative** — Hiro authoritatively said "no name" / "no
 *      identity NFT". State change requires an on-chain tx, so cached 7d.
 *      Invalidated explicitly via {@link invalidateBnsCache} /
 *      {@link invalidateIdentityCache} on write paths (registration, identity
 *      NFT mint detection) and via the manual refresh endpoint.
 *   3. **Lookup failed** — transient Hiro error (429/5xx/timeout/parse). We
 *      don't know whether there's a name/identity. Cached 60s to stop a
 *      request hammer without pinning the state for long.
 *
 * Other caches:
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
const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours (confirmed positive)
/**
 * "Confirmed no name" — Hiro returned `(ok none)`. A state change requires
 * an on-chain BNS registration tx; we bust this cache on registration/update
 * write paths and via the explicit refresh endpoint.
 */
const BNS_CONFIRMED_NEGATIVE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
/**
 * "Lookup failed" — Hiro 429/5xx, malformed response, timeout. Short TTL so
 * a transient upstream blip doesn't pin an address as name-less; long enough
 * to stop a concurrent-request hammer.
 */
const BNS_LOOKUP_FAILED_CACHE_TTL = 60; // 60 seconds
const IDENTITY_CACHE_TTL = 24 * 60 * 60; // 24 hours (immutable NFT once minted)
/**
 * "Confirmed no identity" — Hiro NFT holdings API authoritatively returned
 * no matching NFT. State change requires an on-chain mint; we bust on write
 * paths and via the refresh endpoint.
 */
const IDENTITY_CONFIRMED_NEGATIVE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
/**
 * "Lookup failed" for identity detection — same semantics as BNS failure TTL.
 */
const IDENTITY_LOOKUP_FAILED_CACHE_TTL = 60; // 60 seconds
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

/** Safely delete a KV entry, logging errors. */
async function kvDelete(
  kv: KVNamespace | undefined,
  key: string,
  keyFamily: string,
  logger?: Logger
): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch (error) {
    logger?.error("cache.kv_delete_error", {
      keyFamily,
      key,
      error: String(error),
    });
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

/**
 * Cache a "confirmed no BNS name" response (Hiro returned `(ok none)`).
 * Uses the long {@link BNS_CONFIRMED_NEGATIVE_CACHE_TTL} (7d) because state
 * change requires an on-chain registration. Bust via
 * {@link invalidateBnsCache} on write paths and via the refresh endpoint.
 */
export function setCachedBnsNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:bns:${address}`,
    NONE_SENTINEL,
    BNS_CONFIRMED_NEGATIVE_CACHE_TTL,
    "bns",
    logger
  );
}

/**
 * Cache a BNS lookup failure (Hiro error, malformed response, timeout) for
 * a short TTL ({@link BNS_LOOKUP_FAILED_CACHE_TTL} = 60s). Use this on paths
 * that couldn't determine whether the address has a name — distinct from
 * {@link setCachedBnsNegative} which records "confirmed no name" for 7d.
 *
 * Reuses the `NONE_SENTINEL` value so subsequent reads via
 * {@link getCachedBnsName} treat the entry as "no name" until the short TTL
 * expires and a fresh lookup is attempted.
 */
export function setCachedBnsLookupFailed(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:bns:${address}`,
    NONE_SENTINEL,
    BNS_LOOKUP_FAILED_CACHE_TTL,
    "bns",
    logger
  );
}

/**
 * Delete the cached BNS entry for an address (both positive and negative).
 * Use on write paths (registration completed, manual refresh) so the next
 * lookup re-hits Hiro instead of serving a stale 7d confirmed-negative.
 */
export function invalidateBnsCache(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvDelete(kv, `cache:bns:${address}`, "bns", logger);
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

/**
 * Cache a "confirmed no identity NFT" response (Hiro NFT holdings API
 * authoritatively returned no match for the address). Uses the long
 * {@link IDENTITY_CONFIRMED_NEGATIVE_CACHE_TTL} (7d) because state change
 * requires an on-chain NFT mint. Bust via {@link invalidateIdentityCache}
 * on write paths and via the refresh endpoint.
 */
export function setCachedIdentityNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:identity:${address}`,
    NONE_SENTINEL,
    IDENTITY_CONFIRMED_NEGATIVE_CACHE_TTL,
    "identity",
    logger
  );
}

/**
 * Cache an identity lookup failure (Hiro error, malformed response, timeout)
 * for a short TTL ({@link IDENTITY_LOOKUP_FAILED_CACHE_TTL} = 60s). Use this
 * on paths that couldn't determine whether the address has an identity NFT —
 * distinct from {@link setCachedIdentityNegative} which records "confirmed
 * no identity" for 7d.
 */
export function setCachedIdentityLookupFailed(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:identity:${address}`,
    NONE_SENTINEL,
    IDENTITY_LOOKUP_FAILED_CACHE_TTL,
    "identity",
    logger
  );
}

/**
 * Delete the cached identity entry for an address (both positive and
 * negative). Use on write paths (identity detected and persisted, manual
 * refresh) so the next lookup re-hits Hiro instead of serving a stale 7d
 * confirmed-negative.
 */
export function invalidateIdentityCache(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvDelete(kv, `cache:identity:${address}`, "identity", logger);
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
