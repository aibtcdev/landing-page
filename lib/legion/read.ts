/**
 * Legion snapshot read path — mirrors the leaderboard (app/leaderboard/page.tsx):
 * caches.default as the hot layer + an in-flight singleflight so concurrent
 * cache misses collapse into one rebuild.
 *
 * D1 is the source of truth, kept fresh by the cron. On a cache miss we read
 * D1 and serve whatever row we find IMMEDIATELY — the caller never waits on
 * Hiro. If that row is older than the cron cadence we kick off a background
 * rebuild (ctx.waitUntil) that refreshes D1 + the edge cache for the *next*
 * reader. This is stale-while-revalidate: unlike the leaderboard, whose cold
 * rebuild is one local D1 scan, our rebuild is a multi-call Hiro fan-out, so it
 * must never gate a page render. The only time we build inline is a truly cold
 * read (no row at all) — there is nothing else to show. On production the cron
 * keeps D1 fresh; on preview (no cron) the background revalidate is what keeps
 * the page fast and self-heals D1.
 */

import {
  readLegionSnapshotFromD1,
  writeLegionSnapshotToD1,
} from "./d1";
import { buildLegionSnapshot } from "./snapshot";
import type { LegionSnapshot } from "./types";
import type { Logger } from "../logging";

const CACHE_URL = "https://cache.aibtc.local/legion/snapshot:v1";
const CACHE_TTL_SECONDS = 300; // 5 min — matches the cron cadence.
const STALE_MS = 5 * 60 * 1000; // rebuild from Hiro once the D1 row is older than this.

const inFlight = new Map<string, Promise<LegionSnapshot | null>>();
// Separate guard for the background revalidate so one stale read kicks off at
// most one Hiro rebuild per isolate, no matter how many concurrent readers see
// the stale row.
const revalidating = new Map<string, Promise<void>>();

function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

type Ctx = { waitUntil?: (p: Promise<unknown>) => void } | undefined;

export async function getLegionSnapshot(
  env: CloudflareEnv,
  ctx: Ctx,
  logger?: Logger,
): Promise<LegionSnapshot | null> {
  const cache = getDefaultCache();
  if (cache) {
    const cached = await cache.match(new Request(CACHE_URL, { method: "GET" }));
    if (cached) {
      try {
        return (await cached.json()) as LegionSnapshot;
      } catch {
        // Malformed entry — fall through and rebuild; the put below overwrites it.
      }
    }
  }

  const existing = inFlight.get(CACHE_URL);
  if (existing) return existing;

  const rebuild = (async () => {
    try {
      return await loadOrRebuild(env, ctx, cache, logger);
    } finally {
      inFlight.delete(CACHE_URL);
    }
  })();
  inFlight.set(CACHE_URL, rebuild);
  return rebuild;
}

async function loadOrRebuild(
  env: CloudflareEnv,
  ctx: Ctx,
  cache: Cache | null,
  logger?: Logger,
): Promise<LegionSnapshot | null> {
  const db = env.DB as D1Database | undefined;
  if (!db) return null;

  const snapshot = await readLegionSnapshotFromD1(db);

  // Truly cold (no row at all) — there is nothing to serve, so build inline
  // this once. Combined with the cron (prod) or the background revalidate
  // below (preview), this is the only request that ever waits on Hiro.
  if (!snapshot) {
    logger?.info?.("legion.read_cold_build");
    const built = await buildLegionSnapshot(logger, null, env.HIRO_API_KEY);
    const write = writeLegionSnapshotToD1(db, built);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
    if (cache) await writeCache(cache, ctx, built);
    return built;
  }

  // Warm the edge cache with the row we already have so the next reader skips
  // the D1 round-trip entirely.
  if (cache) await writeCache(cache, ctx, snapshot);

  // Stale-but-present: serve it NOW and refresh in the background. The caller
  // (page SSR or /api/legion) never blocks on the Hiro fan-out — that is the
  // whole difference from the leaderboard, whose rebuild is one local D1 scan.
  if (Date.now() - snapshot.updatedAt > STALE_MS) {
    scheduleRevalidate(db, env, ctx, cache, snapshot, logger);
  }

  return snapshot;
}

/**
 * Fire-and-forget rebuild that refreshes D1 + the edge cache for the next
 * reader. Guarded so a burst of stale reads triggers at most one Hiro fan-out
 * per isolate. Detached via ctx.waitUntil so it outlives the response without
 * delaying it; failures are logged and swallowed (the stale row stays served).
 */
function scheduleRevalidate(
  db: D1Database,
  env: CloudflareEnv,
  ctx: Ctx,
  cache: Cache | null,
  prev: LegionSnapshot,
  logger?: Logger,
): void {
  if (revalidating.has(CACHE_URL)) return;

  const job = (async () => {
    try {
      logger?.info?.("legion.bg_revalidate");
      const built = await buildLegionSnapshot(logger, prev, env.HIRO_API_KEY);
      await writeLegionSnapshotToD1(db, built);
      if (cache) await writeCache(cache, undefined, built); // await the put inside the detached job
    } catch (e) {
      logger?.warn?.("legion.bg_revalidate_failed", { error: String(e) });
    } finally {
      revalidating.delete(CACHE_URL);
    }
  })();

  revalidating.set(CACHE_URL, job);
  if (ctx?.waitUntil) ctx.waitUntil(job);
}

async function writeCache(cache: Cache, ctx: Ctx, snapshot: LegionSnapshot): Promise<void> {
  const response = new Response(JSON.stringify(snapshot), {
    headers: {
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
      "Content-Type": "application/json",
    },
  });
  const put = cache.put(new Request(CACHE_URL, { method: "GET" }), response);
  if (ctx?.waitUntil) ctx.waitUntil(put);
  else await put;
}
