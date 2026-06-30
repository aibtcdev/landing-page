/**
 * Legion snapshot read path — caches.default as the hot layer + an in-flight
 * singleflight so concurrent cache misses collapse into one rebuild, keyed per
 * Legion (and per the registry index). Mirrors the leaderboard read path.
 *
 * D1 is the source of truth, kept fresh by the cron. On a cache miss we read D1
 * and serve whatever row we find IMMEDIATELY — the caller never waits on Hiro.
 * If that row is older than the cron cadence we kick off a background rebuild
 * (ctx.waitUntil) that refreshes D1 + the edge cache for the *next* reader.
 * Stale-while-revalidate: our rebuild is a multi-call Hiro fan-out, so it must
 * never gate a page render. The only time we build inline is a truly cold read
 * (no row at all). On production the cron keeps D1 fresh; on preview (no cron)
 * the background revalidate keeps the page fast and self-heals D1.
 */

import {
  readLegionSnapshotFromD1,
  writeLegionSnapshotToD1,
  readProviderSnapshotFromD1,
  writeProviderSnapshotToD1,
  readRegistrySnapshotFromD1,
  writeRegistrySnapshotToD1,
} from "./d1";
import {
  buildLegionSnapshot,
  buildRegistrySnapshot,
} from "./snapshot";
import { buildProviderSnapshot } from "./providers";
import { demandFallbackEntry, entryFromSummary, getLegion } from "./registry";
import { DEMAND_LEGION_ID } from "./constants";
import type { LegionEntry, LegionSnapshot, ProviderSnapshot, RegistrySnapshot } from "./types";
import type { Logger } from "../logging";

/** Optional per-env override of the inference gateway whose directory backs the
 * v1 provider list. Unset → the default in lib/legion/constants.ts (which serves
 * testnet). Set the `LEGION_GATEWAY_URL` Worker var only if the gateway moves. */
export function legionGatewayUrl(env: CloudflareEnv): string | undefined {
  return (env as unknown as { LEGION_GATEWAY_URL?: string }).LEGION_GATEWAY_URL;
}

const CACHE_TTL_SECONDS = 1800; // 30 min — matches the cron cadence.
const STALE_MS = 30 * 60 * 1000; // rebuild from Hiro once the D1 row is older than this.

type WithUpdatedAt = { updatedAt: number };
type Ctx = { waitUntil?: (p: Promise<unknown>) => void } | undefined;

// Per-cache-key singleflight + background-revalidate guards. Keying by cache URL
// means each Legion (and the registry index) gets its own collapse window.
const inFlight = new Map<string, Promise<WithUpdatedAt | null>>();
const revalidating = new Map<string, Promise<void>>();

function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

function cacheUrl(key: string): string {
  return `https://cache.aibtc.local/legion/${key}:v1`;
}

/**
 * Generic cached snapshot reader (singleflight + SWR). `readD1`/`writeD1`/
 * `rebuild` are the per-snapshot-type hooks; everything else (cache, in-flight
 * collapse, stale revalidate) is shared across demand/provider/registry.
 */
async function getCachedSnapshot<T extends WithUpdatedAt>(
  key: string,
  db: D1Database | undefined,
  ctx: Ctx,
  hooks: {
    readD1: (db: D1Database) => Promise<T | null>;
    writeD1: (db: D1Database, snap: T) => Promise<void>;
    rebuild: (prev: T | null) => Promise<T>;
  },
  logger?: Logger,
): Promise<T | null> {
  if (!db) return null;
  const url = cacheUrl(key);
  const cache = getDefaultCache();

  if (cache) {
    const cached = await cache.match(new Request(url, { method: "GET" }));
    if (cached) {
      try {
        return (await cached.json()) as T;
      } catch {
        // Malformed entry — fall through and rebuild; the put below overwrites it.
      }
    }
  }

  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T | null>;

  const rebuild = (async () => {
    try {
      return await loadOrRebuild(url, db, ctx, cache, hooks, logger);
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, rebuild as Promise<WithUpdatedAt | null>);
  return rebuild;
}

async function loadOrRebuild<T extends WithUpdatedAt>(
  url: string,
  db: D1Database,
  ctx: Ctx,
  cache: Cache | null,
  hooks: {
    readD1: (db: D1Database) => Promise<T | null>;
    writeD1: (db: D1Database, snap: T) => Promise<void>;
    rebuild: (prev: T | null) => Promise<T>;
  },
  logger?: Logger,
): Promise<T | null> {
  const snapshot = await hooks.readD1(db);

  // Truly cold (no row at all) — there is nothing to serve, so build inline
  // this once. Combined with the cron (prod) or the background revalidate
  // below (preview), this is the only request that ever waits on Hiro.
  if (!snapshot) {
    logger?.info?.("legion.read_cold_build", { url });
    const built = await hooks.rebuild(null);
    const write = hooks.writeD1(db, built);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
    if (cache) await writeCache(cache, ctx, url, built);
    return built;
  }

  // Warm the edge cache with the row we already have so the next reader skips
  // the D1 round-trip entirely.
  if (cache) await writeCache(cache, ctx, url, snapshot);

  // Stale-but-present: serve it NOW and refresh in the background. The caller
  // never blocks on the Hiro fan-out.
  if (Date.now() - snapshot.updatedAt > STALE_MS) {
    scheduleRevalidate(url, db, ctx, cache, snapshot, hooks, logger);
  }

  return snapshot;
}

function scheduleRevalidate<T extends WithUpdatedAt>(
  url: string,
  db: D1Database,
  ctx: Ctx,
  cache: Cache | null,
  prev: T,
  hooks: {
    writeD1: (db: D1Database, snap: T) => Promise<void>;
    rebuild: (prev: T | null) => Promise<T>;
  },
  logger?: Logger,
): void {
  if (revalidating.has(url)) return;

  const job = (async () => {
    try {
      logger?.info?.("legion.bg_revalidate", { url });
      const built = await hooks.rebuild(prev);
      await hooks.writeD1(db, built);
      if (cache) await writeCache(cache, undefined, url, built); // await the put inside the detached job
    } catch (e) {
      logger?.warn?.("legion.bg_revalidate_failed", { url, error: String(e) });
    } finally {
      revalidating.delete(url);
    }
  })();

  revalidating.set(url, job);
  if (ctx?.waitUntil) ctx.waitUntil(job);
}

async function writeCache(
  cache: Cache,
  ctx: Ctx,
  url: string,
  snapshot: WithUpdatedAt,
): Promise<void> {
  const response = new Response(JSON.stringify(snapshot), {
    headers: {
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
      "Content-Type": "application/json",
    },
  });
  const put = cache.put(new Request(url, { method: "GET" }), response);
  if (ctx?.waitUntil) ctx.waitUntil(put);
  else await put;
}

// ── Public readers ─────────────────────────────────────────────────────────

/**
 * Demand-Legion detail snapshot. Defaults to the known demand Legion so the
 * back-compat `/legion` route and `/api/legion` keep working unchanged.
 */
export function getLegionSnapshot(
  env: CloudflareEnv,
  ctx: Ctx,
  logger?: Logger,
  legionId: string = DEMAND_LEGION_ID,
  entry?: LegionEntry,
): Promise<LegionSnapshot | null> {
  const resolved = entry ?? demandFallbackEntry();
  return getCachedSnapshot<LegionSnapshot>(
    `snapshot/${legionId}`,
    env.DB as D1Database | undefined,
    ctx,
    {
      readD1: (db) => readLegionSnapshotFromD1(db, legionId),
      writeD1: (db, snap) => writeLegionSnapshotToD1(db, legionId, snap),
      rebuild: (prev) => buildLegionSnapshot(logger, prev, env.HIRO_API_KEY, resolved),
    },
    logger,
  );
}

/** Provider-Legion detail snapshot for a given registry entry. */
export function getProviderSnapshot(
  env: CloudflareEnv,
  ctx: Ctx,
  entry: LegionEntry,
  logger?: Logger,
): Promise<ProviderSnapshot | null> {
  return getCachedSnapshot<ProviderSnapshot>(
    `snapshot/${entry.id}`,
    env.DB as D1Database | undefined,
    ctx,
    {
      readD1: (db) => readProviderSnapshotFromD1(db, entry.id),
      writeD1: (db, snap) => writeProviderSnapshotToD1(db, entry.id, snap),
      rebuild: (prev) =>
        buildProviderSnapshot(entry, prev, env.HIRO_API_KEY, logger, legionGatewayUrl(env)),
    },
    logger,
  );
}

/** The `/legions` index snapshot (registry list). */
export function getRegistrySnapshot(
  env: CloudflareEnv,
  ctx: Ctx,
  logger?: Logger,
): Promise<RegistrySnapshot | null> {
  return getCachedSnapshot<RegistrySnapshot>(
    "registry",
    env.DB as D1Database | undefined,
    ctx,
    {
      readD1: (db) => readRegistrySnapshotFromD1(db),
      writeD1: (db, snap) => writeRegistrySnapshotToD1(db, snap),
      rebuild: () => buildRegistrySnapshot(logger, env.HIRO_API_KEY, legionGatewayUrl(env)),
    },
    logger,
  );
}

/**
 * Resolve a Legion id to its registry entry (with a live Hiro fallback when the
 * registry index hasn't been cached yet). Used by the detail route to decide
 * which snapshot type to render.
 */
export async function resolveLegionEntry(
  env: CloudflareEnv,
  ctx: Ctx,
  id: string,
  logger?: Logger,
): Promise<LegionEntry | null> {
  if (id === DEMAND_LEGION_ID) return demandFallbackEntry();
  // Prefer the cached registry index — reconstruct the entry by convention to
  // avoid a Hiro round-trip on the detail hot path.
  const registry = await getRegistrySnapshot(env, ctx, logger);
  const summary = registry?.legions.find((l) => l.id === id);
  if (summary) return entryFromSummary(summary);
  // Not in the cached index (cold/unknown) — read the registry directly.
  return getLegion(id, env.HIRO_API_KEY, logger);
}
