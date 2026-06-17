/**
 * Legion snapshot read path — mirrors the leaderboard (app/leaderboard/page.tsx):
 * caches.default as the hot layer + an in-flight singleflight so concurrent
 * cache misses collapse into one rebuild.
 *
 * D1 is the source of truth, kept fresh by the cron. On a cache miss we read
 * D1; if the stored row is missing or older than the cron cadence we rebuild
 * from Hiro and persist it. On production the cron keeps D1 fresh, so reads
 * almost never rebuild; on preview (no cron) this is what self-heals the page.
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

  let snapshot = await readLegionSnapshotFromD1(db);
  const stale = !snapshot || Date.now() - snapshot.updatedAt > STALE_MS;

  if (stale) {
    logger?.info?.("legion.read_rebuild", { hadRow: snapshot != null });
    const built = await buildLegionSnapshot(logger, snapshot ?? null, env.HIRO_API_KEY);
    snapshot = built;
    const write = writeLegionSnapshotToD1(db, built);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }

  if (cache && snapshot) await writeCache(cache, ctx, snapshot);
  return snapshot;
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
