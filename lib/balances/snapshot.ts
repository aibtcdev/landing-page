/**
 * Dashboard snapshot: full ranked array of Genesis agents with balances.
 *
 * Cost discipline: warm/stale public requests read one KV snapshot key.
 * Stale snapshots rebuild off the request path via `waitUntil`,
 * single-flighted by a `building` sentinel, and remain available for an hour.
 *
 * Mirrors the pattern in `lib/cache/agent-list.ts`:
 *   - Fresh hit: return immediately.
 *   - Stale hit: return stale, kick off background rebuild.
 *   - Cold miss + another rebuild already in flight: poll briefly so we don't
 *     return an empty page just because we lost the race.
 *   - Cold miss + no rebuild in flight: rebuild synchronously to seed KV.
 *
 * The snapshot only includes Genesis-level agents (level >= 2) — the trading
 * comp's participant set. They self-select by posting on X, so the set is
 * bounded by Genesis count, not total registrations.
 */

import { getCachedAgentList } from "@/lib/cache";
import type { CachedAgent } from "@/lib/cache/types";
import type { Logger } from "@/lib/logging";
import {
  BALANCE_FETCH_CONCURRENCY,
  SNAPSHOT_BUILDING_KEY,
  SNAPSHOT_BUILDING_TTL_SECONDS,
  SNAPSHOT_CACHE_KEY,
  SNAPSHOT_FRESH_WINDOW_SECONDS,
  SNAPSHOT_HARD_TTL_SECONDS,
} from "./constants";
import { fetchAgentBalances } from "./fetch";
import type { AgentBalance, TokenBalance } from "./types";

export interface DashboardSnapshot {
  agents: AgentBalance[];
  stats: {
    /** Number of Genesis (Level 2+) agents in the snapshot. */
    total: number;
    /** Agents whose fetch returned partial data (one upstream failed). */
    partialCount: number;
  };
  cachedAt: string;
}

type WaitUntil = (promise: Promise<unknown>) => void;

const COLD_MISS_POLL_MS = 1500;
const COLD_MISS_POLL_INTERVAL_MS = 150;

function isFresh(snapshot: DashboardSnapshot): boolean {
  const cachedAt = Date.parse(snapshot.cachedAt);
  if (Number.isNaN(cachedAt)) return false;
  return Date.now() - cachedAt < SNAPSHOT_FRESH_WINDOW_SECONDS * 1000;
}

function parseSnapshot(raw: string | null): DashboardSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardSnapshot;
  } catch {
    return null;
  }
}

/**
 * Read the dashboard snapshot from KV.
 *
 * Pass `waitUntil` from `getCloudflareContext()` so stale-cache rebuilds run
 * after the response is sent rather than blocking it. True cold misses still
 * rebuild synchronously to seed the first snapshot.
 */
export async function getDashboardSnapshot(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  waitUntil?: WaitUntil,
  logger?: Logger
): Promise<DashboardSnapshot> {
  const raw = await kv.get(SNAPSHOT_CACHE_KEY);
  const cached = parseSnapshot(raw);

  // Corrupted entry — drop it so we don't hit the parse failure for the full
  // hard TTL window.
  if (raw && !cached) {
    await kv.delete(SNAPSHOT_CACHE_KEY).catch(() => {});
  }

  if (cached) {
    if (isFresh(cached)) return cached;

    const rebuild = maybeTriggerBackgroundRebuild(kv, hiroApiKey, logger);
    if (waitUntil) waitUntil(rebuild);
    return cached;
  }

  // Cold miss. If a rebuild is in flight, poll briefly so the caller gets
  // fresh data instead of an empty array.
  if (await kv.get(SNAPSHOT_BUILDING_KEY)) {
    const waited = await pollForSnapshot(kv);
    if (waited) return waited;
    // Rebuild didn't finish in time — fall through and rebuild ourselves.
  }

  try {
    await kv.put(SNAPSHOT_BUILDING_KEY, "1", {
      expirationTtl: SNAPSHOT_BUILDING_TTL_SECONDS,
    });
  } catch {
    // If sentinel write fails, proceed anyway — worst case is a duplicate rebuild.
  }

  try {
    return await rebuildSnapshot(kv, hiroApiKey, logger);
  } finally {
    await kv.delete(SNAPSHOT_BUILDING_KEY).catch(() => {});
  }
}

async function pollForSnapshot(
  kv: KVNamespace
): Promise<DashboardSnapshot | null> {
  const deadline = Date.now() + COLD_MISS_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COLD_MISS_POLL_INTERVAL_MS));
    const snapshot = parseSnapshot(await kv.get(SNAPSHOT_CACHE_KEY));
    if (snapshot) return snapshot;
  }
  return null;
}

async function maybeTriggerBackgroundRebuild(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<void> {
  if (await kv.get(SNAPSHOT_BUILDING_KEY)) return;
  try {
    await kv.put(SNAPSHOT_BUILDING_KEY, "1", {
      expirationTtl: SNAPSHOT_BUILDING_TTL_SECONDS,
    });
  } catch {
    return;
  }
  try {
    await rebuildSnapshot(kv, hiroApiKey, logger);
  } catch {
    // Stale snapshot is already being served; swallow rebuild errors.
  } finally {
    await kv.delete(SNAPSHOT_BUILDING_KEY).catch(() => {});
  }
}

/**
 * Force the next read to rebuild the snapshot.
 */
export async function invalidateDashboardSnapshot(
  kv: KVNamespace
): Promise<void> {
  try {
    await kv.delete(SNAPSHOT_CACHE_KEY);
  } catch {
    // Best-effort
  }
}

function rawFor(
  tokens: TokenBalance[],
  symbol: TokenBalance["symbol"]
): bigint {
  const t = tokens.find((x) => x.symbol === symbol);
  return t ? BigInt(t.balance) : BigInt(0);
}

/** Sort: sBTC desc → BTC desc → STX desc, raw integer comparison. */
function compareAgents(a: AgentBalance, b: AgentBalance): number {
  const sbtcDelta = rawFor(b.tokens, "sBTC") - rawFor(a.tokens, "sBTC");
  if (sbtcDelta !== BigInt(0)) return sbtcDelta > 0 ? 1 : -1;
  const btcDelta = rawFor(b.tokens, "BTC") - rawFor(a.tokens, "BTC");
  if (btcDelta !== BigInt(0)) return btcDelta > 0 ? 1 : -1;
  const stxDelta = rawFor(b.tokens, "STX") - rawFor(a.tokens, "STX");
  if (stxDelta !== BigInt(0)) return stxDelta > 0 ? 1 : -1;
  return 0;
}

async function rebuildSnapshot(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<DashboardSnapshot> {
  const list = await getCachedAgentList(kv);
  const genesisAgents: CachedAgent[] = list.agents.filter((a) => a.level >= 2);

  const agents: AgentBalance[] = [];
  for (let i = 0; i < genesisAgents.length; i += BALANCE_FETCH_CONCURRENCY) {
    const batch = genesisAgents.slice(i, i + BALANCE_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (agent) => {
        const result = await fetchAgentBalances(
          agent.stxAddress,
          agent.btcAddress,
          kv,
          hiroApiKey,
          logger
        );
        const row: AgentBalance = {
          stxAddress: agent.stxAddress,
          btcAddress: agent.btcAddress,
          displayName: agent.displayName,
          bnsName: agent.bnsName,
          level: agent.level,
          levelName: agent.levelName,
          tokens: result.tokens,
        };
        if (result.partial) row.fetchError = "partial";
        return row;
      })
    );
    agents.push(...results);
  }

  agents.sort(compareAgents);

  const snapshot: DashboardSnapshot = {
    agents,
    stats: {
      total: agents.length,
      partialCount: agents.filter((a) => a.fetchError).length,
    },
    cachedAt: new Date().toISOString(),
  };

  try {
    await kv.put(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot), {
      expirationTtl: SNAPSHOT_HARD_TTL_SECONDS,
    });
  } catch {
    // Best-effort — caller still gets the fresh snapshot.
  }

  logger?.info("dashboard.snapshot.rebuilt", {
    genesisCount: agents.length,
    partialCount: snapshot.stats.partialCount,
  });

  return snapshot;
}
