/**
 * Dashboard snapshot cache.
 *
 * Mirrors the proven `lib/cache/agent-list.ts` SWR pattern:
 * - Fresh window: 2 min — return immediately, no rebuild.
 * - Stale window (up to 10 min): return stale, kick off background rebuild.
 * - Cold miss: poll briefly if another request is rebuilding, otherwise
 *   build synchronously.
 *
 * Cost discipline:
 * - One KV key (`cache:dashboard`) — no per-agent fan-out writes.
 * - Sentinel-gated rebuild prevents thundering herd.
 * - Per-agent fetches are bounded by `BALANCE_FETCH_CONCURRENCY` and each
 *   honours the 60s upstream-failure sentinel from `fetch.ts`.
 * - Reuses the existing `getCachedAgentList` to source agent rows — never
 *   does its own `kv.list` scan.
 */

import { getCachedAgentList } from "@/lib/cache";
import type { Logger } from "@/lib/logging";
import {
  BALANCE_FETCH_CONCURRENCY,
  DASHBOARD_BUILDING_KEY,
  DASHBOARD_BUILDING_TTL_SECONDS,
  DASHBOARD_CACHE_KEY,
  DASHBOARD_CACHE_TTL_SECONDS,
  DASHBOARD_FRESH_WINDOW_SECONDS,
} from "./constants";
import { fetchAgentBalances } from "./fetch";
import { getPriceSnapshot } from "./prices";
import type { AgentBalance, DashboardSnapshot } from "./types";

type WaitUntil = (promise: Promise<unknown>) => void;

const COLD_MISS_POLL_MS = 1500;
const COLD_MISS_POLL_INTERVAL_MS = 150;

function isFresh(snapshot: DashboardSnapshot): boolean {
  const cachedAt = Date.parse(snapshot.cachedAt);
  if (Number.isNaN(cachedAt)) return false;
  return Date.now() - cachedAt < DASHBOARD_FRESH_WINDOW_SECONDS * 1000;
}

function parseSnapshot(raw: string | null): DashboardSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardSnapshot;
  } catch {
    return null;
  }
}

async function pollForCache(
  kv: KVNamespace
): Promise<DashboardSnapshot | null> {
  const deadline = Date.now() + COLD_MISS_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COLD_MISS_POLL_INTERVAL_MS));
    const snap = parseSnapshot(await kv.get(DASHBOARD_CACHE_KEY));
    if (snap) return snap;
  }
  return null;
}

async function maybeTriggerBackgroundRebuild(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<void> {
  if (await kv.get(DASHBOARD_BUILDING_KEY)) return;
  try {
    await kv.put(DASHBOARD_BUILDING_KEY, "1", {
      expirationTtl: DASHBOARD_BUILDING_TTL_SECONDS,
    });
  } catch {
    return;
  }
  try {
    await rebuildSnapshot(kv, hiroApiKey, logger);
  } catch (e) {
    logger?.error("dashboard.rebuild_failed", { error: (e as Error).message });
  } finally {
    await kv.delete(DASHBOARD_BUILDING_KEY).catch(() => {});
  }
}

/**
 * Fetch the cached dashboard snapshot.
 *
 * Returns immediately on fresh hit. On stale, returns the stale snapshot
 * and kicks off a background rebuild. On cold miss, polls briefly for an
 * in-flight rebuild before building synchronously.
 */
export async function getDashboardSnapshot(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  waitUntil?: WaitUntil,
  logger?: Logger
): Promise<DashboardSnapshot> {
  const raw = await kv.get(DASHBOARD_CACHE_KEY);
  const cached = parseSnapshot(raw);

  if (raw && !cached) {
    await kv.delete(DASHBOARD_CACHE_KEY).catch(() => {});
  }

  if (cached) {
    if (isFresh(cached)) return cached;
    const rebuild = maybeTriggerBackgroundRebuild(kv, hiroApiKey, logger);
    if (waitUntil) waitUntil(rebuild);
    return cached;
  }

  if (await kv.get(DASHBOARD_BUILDING_KEY)) {
    const waited = await pollForCache(kv);
    if (waited) return waited;
  }

  try {
    await kv.put(DASHBOARD_BUILDING_KEY, "1", {
      expirationTtl: DASHBOARD_BUILDING_TTL_SECONDS,
    });
  } catch {
    // Proceed anyway — duplicate rebuild is wasteful, not incorrect
  }

  try {
    return await rebuildSnapshot(kv, hiroApiKey, logger);
  } finally {
    await kv.delete(DASHBOARD_BUILDING_KEY).catch(() => {});
  }
}

/**
 * Force the next read to rebuild. Use sparingly — the SWR pattern already
 * keeps data fresh on its own.
 */
export async function invalidateDashboardSnapshot(
  kv: KVNamespace
): Promise<void> {
  try {
    await kv.delete(DASHBOARD_CACHE_KEY);
  } catch {
    // Best-effort
  }
}

/**
 * Rebuild the snapshot from scratch:
 * - Read agent list from existing `cache:agent-list` (one KV read).
 * - Fetch prices once (KV-cached for 5 min).
 * - Fan out per-agent balance fetches in batches of BALANCE_FETCH_CONCURRENCY.
 *   Each fetch honours the upstream-failure sentinel.
 */
async function rebuildSnapshot(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<DashboardSnapshot> {
  const [agentList, priceSnap] = await Promise.all([
    getCachedAgentList(kv),
    getPriceSnapshot(kv, logger),
  ]);

  const agents: AgentBalance[] = [];
  for (let i = 0; i < agentList.agents.length; i += BALANCE_FETCH_CONCURRENCY) {
    const batch = agentList.agents.slice(i, i + BALANCE_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (agent) => {
        const result = await fetchAgentBalances(
          agent.stxAddress,
          agent.btcAddress,
          priceSnap,
          kv,
          hiroApiKey,
          logger
        );
        const balance: AgentBalance = {
          stxAddress: agent.stxAddress,
          btcAddress: agent.btcAddress,
          displayName: agent.displayName,
          bnsName: agent.bnsName,
          level: agent.level,
          levelName: agent.levelName,
          tokens: result.tokens,
          totalUsd: result.totalUsd,
        };
        if (result.partial) balance.fetchError = "partial";
        return balance;
      })
    );
    agents.push(...results);
  }

  // Sort by total USD desc — leaderboard order
  agents.sort((a, b) => b.totalUsd - a.totalUsd);

  const totalUsd = agents.reduce((sum, a) => sum + a.totalUsd, 0);
  const snapshot: DashboardSnapshot = {
    agents,
    prices: priceSnap.prices,
    stats: {
      total: agents.length,
      totalUsd,
      pricedAt: priceSnap.fetchedAt,
    },
    cachedAt: new Date().toISOString(),
  };

  try {
    await kv.put(DASHBOARD_CACHE_KEY, JSON.stringify(snapshot), {
      expirationTtl: DASHBOARD_CACHE_TTL_SECONDS,
    });
  } catch {
    // Best-effort — caller still gets the result
  }

  return snapshot;
}
