/**
 * Caching for stable data (BNS names, agent identities, reputation)
 *
 * Three-state cache model for BNS/identity lookups:
 *   1. **Confirmed positive** — Hiro returned a name/identity. Cached 24h.
 *   2. **Confirmed negative** — Hiro authoritatively said "no name" /
 *      "no identity NFT". State change requires an on-chain tx, so cached 7d.
 *      Invalidated explicitly via {@link invalidateBnsCache} /
 *      {@link invalidateIdentityCache} on write paths (registration, identity
 *      NFT mint detection) and via the manual refresh endpoint.
 *   3. **Lookup failed** — transient Hiro error (429/5xx/timeout/parse). We
 *      don't know whether there's a name/identity. Cached 60s to stop a
 *      request hammer without pinning the state for long.
 *
 * Storage backends (as of migration 013_identity_cache.sql):
 *   - BNS cache  (`cache_type = 'bns'`)      → D1 `identity_cache` + `caches.default`
 *   - Identity cache (`cache_type = 'identity'`) → D1 `identity_cache` + `caches.default`
 *   - Reputation cache → KV (low volume, out of scope)
 *   - Transaction cache → KV (low volume, out of scope)
 *
 * `caches.default` is the hot-read layer (no D1 cost on hit). D1 is the
 * persistence layer (survives Worker restart, multi-region replication).
 * Cache keys include the cache_type so the 60s lookup-failed state for
 * one type cannot poison a 24h confirmed-positive entry for another.
 *
 * All public functions accept an optional {@link Logger}. When provided, cache
 * hit/miss telemetry and errors are emitted through that logger (and on to
 * worker-logs). When omitted, the helpers are silent.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentIdentity } from "./types";
import type { Logger } from "../logging";
import { samplingFor } from "../logging";

// ---------------------------------------------------------------------------
// Cache TTLs in seconds
// ---------------------------------------------------------------------------

const BNS_CACHE_TTL = 24 * 60 * 60; // 24 hours (confirmed positive)
/**
 * "Confirmed no name" — Hiro returned `(ok none)` / `ERR-NO-PRIMARY-NAME`.
 *
 * Kept deliberately short (6h, not 7d) because a BNS primary name is *mutable*:
 * an agent can call `set-primary-name` at any time after registering, and
 * nothing on the write side busts this entry. With a 7d TTL an agent who
 * registers before owning a name (the common case) stays `bnsName: null` for
 * up to a week — the lazy refresh in `/api/agents/[address]` reads *through*
 * this cache (`lookupBnsName` → `getCachedBnsName`) and so can never re-hit
 * Hiro until the entry expires. 6h bounds that staleness while still absorbing
 * a profile-view hammer. This is the asymmetry with identity NFTs below: an
 * NFT can't be un-minted, so its negative is safe to cache for 7d; a primary
 * name can appear (and change) with no event we observe. See issue #946.
 *
 * The `POST /api/identity/:address/refresh` endpoint remains the instant
 * manual escape hatch (it calls `invalidateBnsCache` before re-looking up).
 */
const BNS_CONFIRMED_NEGATIVE_CACHE_TTL = 6 * 60 * 60; // 6 hours
/**
 * "Lookup failed" — Hiro 429/5xx, malformed response, timeout. Short TTL so
 * a transient upstream blip doesn't pin an address as name-less; long enough
 * to stop a concurrent-request hammer.
 */
const BNS_LOOKUP_FAILED_CACHE_TTL = 60; // 60 seconds
/**
 * "Contract-reported error" — Hiro returned `{okay: false}` from BNS V2
 * `get-primary`. 5 min avoids re-hitting Hiro every 60s while still short
 * enough to recover from any genuine one-off contract hiccup.
 */
const BNS_CONTRACT_ERROR_CACHE_TTL = 5 * 60; // 5 minutes
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
const REPUTATION_CACHE_TTL = 60 * 60; // 1 hour (raised from 5 minutes)
/**
 * "Lookup failed" for reputation — same semantics as BNS / identity failure TTL.
 */
const REPUTATION_LOOKUP_FAILED_CACHE_TTL = 60; // 60 seconds
const TX_CACHE_TTL = 30 * 60; // 30 minutes (raised from 5 minutes)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from a cache lookup: distinguishes miss ({hit:false}) from cached null ({hit:true,value:null}). */
export type CacheResult<T> = { hit: true; value: T | null } | { hit: false };

/**
 * Tri-state outcome for authoritative BNS / identity lookups.
 */
export type LookupOutcomeState =
  | "positive"
  | "confirmed-negative"
  | "lookup-failed";

/** Sentinel value for negative cache entries (address has no BNS name or on-chain identity). */
export const NONE_SENTINEL = "__NONE__";

/** @deprecated Use NONE_SENTINEL instead. */
export const BNS_NONE_SENTINEL = NONE_SENTINEL;

// ---------------------------------------------------------------------------
// Internal: D1 identity_cache table types
// ---------------------------------------------------------------------------

type CacheType = "bns" | "identity";
type CacheState =
  | "positive"
  | "confirmed-negative"
  | "lookup-failed"
  | "contract-error";

interface IdentityCacheRow {
  state: CacheState;
  value: string | null;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Internal: caches.default helpers (mirrors pattern from lib/edge-cache.ts)
// ---------------------------------------------------------------------------

const CACHE_HOST = "https://identity-cache.aibtc.local";

function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

function buildIdentityCacheKey(type: CacheType, address: string): string {
  return `${CACHE_HOST}/${type}/${encodeURIComponent(address.toLowerCase())}`;
}

// ---------------------------------------------------------------------------
// Internal: D1 read/write helpers
// ---------------------------------------------------------------------------

/**
 * Get the D1 database handle. Returns null when called outside a Workers
 * runtime (local dev / test) — callers treat null as a cache miss.
 */
async function getDb(): Promise<D1Database | null> {
  try {
    const { env } = await getCloudflareContext();
    return (env as unknown as { DB?: D1Database }).DB ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a row from D1 `identity_cache`. Returns null on miss, expired row,
 * or any D1 error. Expired rows are not deleted here — they are overwritten
 * lazily on the next write (INSERT OR REPLACE).
 */
async function d1Get(
  type: CacheType,
  address: string,
  logger?: Logger
): Promise<IdentityCacheRow | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const row = await db
      .prepare(
        "SELECT state, value, expires_at FROM identity_cache WHERE cache_type = ? AND address = ?"
      )
      .bind(type, address.toLowerCase())
      .first<IdentityCacheRow>();

    if (!row) return null;

    // Evict expired entries at read time
    if (new Date(row.expires_at) <= new Date()) {
      return null;
    }

    return row;
  } catch (error) {
    logger?.error("cache.d1_read_error", {
      type,
      address,
      error: String(error),
    });
    return null;
  }
}

/**
 * Write a row to D1 `identity_cache` (INSERT OR REPLACE). No-op on error.
 * Takes the absolute `expiresAt` ISO string rather than a TTL so the caller
 * is the single owner of the now-vs-expiry computation (see `layeredPut`).
 */
async function d1Put(
  type: CacheType,
  address: string,
  state: CacheState,
  value: string | null,
  expiresAt: string,
  logger?: Logger
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO identity_cache (cache_type, address, state, value, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(type, address.toLowerCase(), state, value, expiresAt)
      .run();
  } catch (error) {
    logger?.error("cache.d1_write_error", {
      type,
      address,
      error: String(error),
    });
  }
}

/**
 * Delete a row from D1 `identity_cache`. No-op on error.
 */
async function d1Delete(
  type: CacheType,
  address: string,
  logger?: Logger
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .prepare(
        "DELETE FROM identity_cache WHERE cache_type = ? AND address = ?"
      )
      .bind(type, address.toLowerCase())
      .run();
  } catch (error) {
    logger?.error("cache.d1_delete_error", {
      type,
      address,
      error: String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Internal: caches.default read/write helpers for identity_cache
// ---------------------------------------------------------------------------

/**
 * Read a cached row from `caches.default`. Returns null on miss or any error.
 * The cached Response body is JSON-encoded `IdentityCacheRow`.
 */
async function edgeCacheGet(
  type: CacheType,
  address: string
): Promise<IdentityCacheRow | null> {
  const cache = getDefaultCache();
  if (!cache) return null;

  try {
    const key = new Request(buildIdentityCacheKey(type, address), {
      method: "GET",
    });
    const cached = await cache.match(key);
    if (!cached) return null;

    const row = (await cached.json()) as IdentityCacheRow;
    // Double-check expiry in case the edge cache served a stale entry
    if (new Date(row.expires_at) <= new Date()) return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Write a row to `caches.default`. The cached Response body is
 * JSON-encoded `IdentityCacheRow`. Uses `Cache-Control: max-age` so the
 * edge cache honors the TTL natively.
 */
async function edgeCachePut(
  type: CacheType,
  address: string,
  row: IdentityCacheRow,
  ttlSeconds: number
): Promise<void> {
  const cache = getDefaultCache();
  if (!cache) return;

  try {
    const key = new Request(buildIdentityCacheKey(type, address), {
      method: "GET",
    });
    const response = new Response(JSON.stringify(row), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${ttlSeconds}`,
      },
    });
    await cache.put(key, response);
  } catch {
    // Best-effort — D1 is the persistent source of truth.
  }
}

/**
 * Delete a row from `caches.default`. Best-effort.
 */
async function edgeCacheDelete(type: CacheType, address: string): Promise<void> {
  const cache = getDefaultCache();
  if (!cache) return;

  try {
    const key = new Request(buildIdentityCacheKey(type, address), {
      method: "GET",
    });
    await cache.delete(key);
  } catch {
    // Best-effort — D1 is the persistent source of truth.
  }
}

// ---------------------------------------------------------------------------
// Internal: combined D1 + caches.default read
// ---------------------------------------------------------------------------

/**
 * Read from the two-layer cache (caches.default → D1). On a D1 hit that
 * was a caches.default miss, the entry is written back to caches.default
 * to warm the hot layer for the row's full remaining TTL — the D1 expiry
 * is the source of truth for "when does this entry die," so the edge cache
 * should honor it instead of being capped by the fresh-write TTL constant.
 */
async function layeredGet(
  type: CacheType,
  address: string,
  logger?: Logger
): Promise<IdentityCacheRow | null> {
  // Hot layer first
  const edgeRow = await edgeCacheGet(type, address);
  if (edgeRow) return edgeRow;

  // Cold layer
  const d1Row = await d1Get(type, address, logger);
  if (!d1Row) return null;

  // Warm the hot layer with the row's full remaining TTL (avoid writing with
  // negative TTL). Register the put with ctx.waitUntil so the Workers runtime
  // doesn't cancel it when the request handler returns — falling back to
  // await when ctx is absent (local dev / test). Mirrors the pattern from
  // lib/edge-cache.ts:94.
  const remainingMs = new Date(d1Row.expires_at).getTime() - Date.now();
  const remainingSeconds = Math.floor(remainingMs / 1000);
  if (remainingSeconds > 0) {
    const stash = edgeCachePut(type, address, d1Row, remainingSeconds);
    try {
      const { ctx } = await getCloudflareContext();
      if (ctx) {
        ctx.waitUntil(stash);
      } else {
        await stash;
      }
    } catch {
      await stash;
    }
  }

  return d1Row;
}

// ---------------------------------------------------------------------------
// Internal: combined D1 + caches.default write
// ---------------------------------------------------------------------------

async function layeredPut(
  type: CacheType,
  address: string,
  state: CacheState,
  value: string | null,
  ttlSeconds: number,
  logger?: Logger
): Promise<void> {
  // Compute `expiresAt` once and pass it through to both layers — the D1
  // row's `expires_at` column and the edge cache's `IdentityCacheRow.expires_at`
  // body field stay in lockstep, no sub-ms drift between two `Date.now()` reads.
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const row: IdentityCacheRow = { state, value, expires_at: expiresAt };

  await Promise.all([
    d1Put(type, address, state, value, expiresAt, logger),
    edgeCachePut(type, address, row, ttlSeconds),
  ]);
}

// ---------------------------------------------------------------------------
// Internal: combined D1 + caches.default delete
// ---------------------------------------------------------------------------

async function layeredDelete(
  type: CacheType,
  address: string,
  logger?: Logger
): Promise<void> {
  await Promise.all([
    d1Delete(type, address, logger),
    edgeCacheDelete(type, address),
  ]);
}

// ---------------------------------------------------------------------------
// Internal: KV helpers (retained for reputation + transaction caches only)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal: telemetry
// ---------------------------------------------------------------------------

/**
 * Emit a structured cache-hit/miss telemetry event via the logger.
 * Sampled at 5% via samplingFor("cache.event") — same semantics as before.
 */
function logCacheEvent(
  logger: Logger | undefined,
  event: "cache.hit" | "cache.miss",
  keyFamily: string,
  key: string,
  negative = false
): void {
  if (!logger) return;
  const { keep, rate } = samplingFor("cache.event", `${keyFamily}:${key}`);
  if (!keep) return;
  const payload: Record<string, unknown> = { keyFamily, key };
  if (negative) payload.negative = true;
  if (rate < 1) {
    payload.sampled = true;
    payload.sample_rate = rate;
  }
  logger.info(event, payload);
}

/**
 * Read and JSON-parse a cached value from KV, emitting telemetry on hit/miss.
 * Used by reputation and transaction caches that remain on KV.
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
 * Read a KV cache entry that uses NONE_SENTINEL. Used by reputation cache.
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

// ---------------------------------------------------------------------------
// Public: BNS cache (D1 + caches.default — no KV writes)
// ---------------------------------------------------------------------------
//
// Every BNS and identity helper in this section accepts `kv?: KVNamespace`
// but ignores it — storage moved to D1 + `caches.default` in migration
// 013_identity_cache.sql. The parameter is retained only so the dozens of
// existing call sites compile without a coordinated update; a future cleanup
// PR can drop the arg from the signatures. Reputation and transaction
// helpers (further down) still use `kv` because those caches were
// intentionally left on KV.

/**
 * Get the cached BNS name for a Stacks address.
 *
 * Returns the cached name string, NONE_SENTINEL (for both confirmed-negative
 * and lookup-failed hits — callers use this as "no name for now"), or null
 * (cache miss — caller should hit Hiro).
 */
export async function getCachedBnsName(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<string | null> {
  const row = await layeredGet("bns", address, logger);

  if (!row) {
    logCacheEvent(logger, "cache.miss", "bns", address);
    return null;
  }

  if (row.state === "positive" && row.value) {
    logCacheEvent(logger, "cache.hit", "bns", address, false);
    return row.value;
  }

  // confirmed-negative or lookup-failed both surface as NONE_SENTINEL
  logCacheEvent(logger, "cache.hit", "bns", address, true);
  return NONE_SENTINEL;
}

export function setCachedBnsName(
  address: string,
  name: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut("bns", address, "positive", name, BNS_CACHE_TTL, logger);
}

/**
 * Cache a "confirmed no BNS name" response (Hiro returned `(ok none)`).
 * Uses {@link BNS_CONFIRMED_NEGATIVE_CACHE_TTL} (6h) — kept short because a
 * BNS primary name is mutable and nothing on the write side busts this entry.
 */
export function setCachedBnsNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "bns",
    address,
    "confirmed-negative",
    null,
    BNS_CONFIRMED_NEGATIVE_CACHE_TTL,
    logger
  );
}

/**
 * Cache a BNS lookup failure (Hiro error, malformed response, timeout) for
 * a short TTL ({@link BNS_LOOKUP_FAILED_CACHE_TTL} = 60s).
 */
export function setCachedBnsLookupFailed(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "bns",
    address,
    "lookup-failed",
    null,
    BNS_LOOKUP_FAILED_CACHE_TTL,
    logger
  );
}

/**
 * Cache a BNS contract-reported error (Hiro returned `{okay: false}`) for a
 * medium TTL ({@link BNS_CONTRACT_ERROR_CACHE_TTL} = 5min). Stored under its
 * own `contract-error` state so the row reflects which branch wrote it —
 * downstream telemetry can distinguish a 5-min contract-error hit from a
 * 60s transient lookup-failed hit even though both surface as NONE_SENTINEL
 * to callers.
 */
export function setCachedBnsContractError(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "bns",
    address,
    "contract-error",
    null,
    BNS_CONTRACT_ERROR_CACHE_TTL,
    logger
  );
}

/**
 * Delete the cached BNS entry for an address (both positive and negative).
 * Use on write paths (registration completed, manual refresh) so the next
 * lookup re-hits Hiro instead of serving a stale confirmed-negative entry.
 */
export function invalidateBnsCache(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredDelete("bns", address, logger);
}

// ---------------------------------------------------------------------------
// Public: Identity cache (D1 + caches.default — no KV writes)
// ---------------------------------------------------------------------------

export async function getCachedIdentity(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<CacheResult<AgentIdentity>> {
  const row = await layeredGet("identity", address, logger);

  if (!row) {
    logCacheEvent(logger, "cache.miss", "identity", address);
    return { hit: false };
  }

  if (row.state === "positive" && row.value) {
    try {
      const identity = JSON.parse(row.value) as AgentIdentity;
      logCacheEvent(logger, "cache.hit", "identity", address);
      return { hit: true, value: identity };
    } catch (error) {
      logger?.error("cache.parse_error", {
        keyFamily: "identity",
        key: address,
        error: String(error),
      });
      return { hit: false };
    }
  }

  // confirmed-negative or lookup-failed: hit with null value
  logCacheEvent(logger, "cache.hit", "identity", address, true);
  return { hit: true, value: null };
}

export function setCachedIdentity(
  address: string,
  identity: AgentIdentity,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "identity",
    address,
    "positive",
    JSON.stringify(identity),
    IDENTITY_CACHE_TTL,
    logger
  );
}

/**
 * Cache a "confirmed no identity NFT" response. Uses the long
 * {@link IDENTITY_CONFIRMED_NEGATIVE_CACHE_TTL} (7d) because state change
 * requires an on-chain NFT mint.
 */
export function setCachedIdentityNegative(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "identity",
    address,
    "confirmed-negative",
    null,
    IDENTITY_CONFIRMED_NEGATIVE_CACHE_TTL,
    logger
  );
}

/**
 * Cache an identity lookup failure (Hiro error, malformed response, timeout)
 * for a short TTL ({@link IDENTITY_LOOKUP_FAILED_CACHE_TTL} = 60s).
 */
export function setCachedIdentityLookupFailed(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredPut(
    "identity",
    address,
    "lookup-failed",
    null,
    IDENTITY_LOOKUP_FAILED_CACHE_TTL,
    logger
  );
}

/**
 * Delete the cached identity entry for an address (both positive and
 * negative).
 */
export function invalidateIdentityCache(
  address: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return layeredDelete("identity", address, logger);
}

// ---------------------------------------------------------------------------
// Public: Reputation cache (remains on KV — low volume, out of P2 scope)
// ---------------------------------------------------------------------------

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

/**
 * Cache a reputation lookup failure for a short TTL.
 */
export function setCachedReputationLookupFailed(
  key: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<void> {
  return kvPut(
    kv,
    `cache:reputation:${key}`,
    NONE_SENTINEL,
    REPUTATION_LOOKUP_FAILED_CACHE_TTL,
    "reputation",
    logger
  );
}

// ---------------------------------------------------------------------------
// Public: Transaction cache (remains on KV — low volume, out of P2 scope)
// ---------------------------------------------------------------------------

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
