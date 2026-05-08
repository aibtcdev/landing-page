/**
 * KV-backed cache for the enriched agent list.
 *
 * Replaces O(N) KV scans on every page load with a single KV read.
 * Uses a stale-while-revalidate pattern: cached data is kept for 10 minutes
 * (hard TTL) but considered fresh for only 2 minutes. Stale hits trigger a
 * background rebuild without blocking the response, so readers never see an
 * empty list just because another request happens to be rebuilding.
 *
 * Mutation endpoints call invalidateAgentListCache() to force a rebuild.
 */

import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { getAgentsIndex } from "@/lib/agents-index";
import type { CachedAgent, CachedAgentList } from "./types";

const CACHE_KEY = "cache:agent-list";
// Hard TTL — snapshot persists in KV well beyond its freshness window so we
// can always serve stale data while a rebuild happens in the background.
const CACHE_TTL_SECONDS = 600; // 10 minutes
// Freshness window — within this age from `cachedAt`, no rebuild is needed.
const FRESH_WINDOW_SECONDS = 120; // 2 minutes

// Sentinel key written during rebuild to prevent thundering herd.
const BUILDING_KEY = "cache:agent-list:building";
const BUILDING_TTL_SECONDS = 60;

// When there's no cache at all AND another request is already rebuilding,
// poll briefly for the rebuild to finish instead of returning an empty list.
const COLD_MISS_POLL_MS = 1500;
const COLD_MISS_POLL_INTERVAL_MS = 150;

type WaitUntil = (promise: Promise<unknown>) => void;

function isFresh(snapshot: CachedAgentList): boolean {
  const cachedAt = Date.parse(snapshot.cachedAt);
  if (Number.isNaN(cachedAt)) return false;
  return Date.now() - cachedAt < FRESH_WINDOW_SECONDS * 1000;
}

function parseSnapshot(raw: string | null): CachedAgentList | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedAgentList;
  } catch {
    return null;
  }
}

/**
 * Get the cached agent list from KV.
 *
 * - Fresh hit: return immediately.
 * - Stale hit: return the stale snapshot and kick off a background rebuild.
 *   If `waitUntil` is provided, the rebuild runs after the response is sent;
 *   otherwise it runs fire-and-forget (best-effort on Workers).
 * - Cold miss: if another request is already rebuilding, poll briefly so we
 *   can serve the fresh result instead of an empty list. Otherwise rebuild
 *   synchronously.
 */
export async function getCachedAgentList(
  kv: KVNamespace,
  waitUntil?: WaitUntil
): Promise<CachedAgentList> {
  const raw = await kv.get(CACHE_KEY);
  const cached = parseSnapshot(raw);

  // Corrupted entry — delete it so we don't keep hitting the parse failure
  // for the full 600s hard TTL.
  if (raw && !cached) {
    await kv.delete(CACHE_KEY).catch(() => {});
  }

  if (cached) {
    if (isFresh(cached)) return cached;

    // Stale — trigger a background rebuild but return what we have.
    const rebuild = maybeTriggerBackgroundRebuild(kv);
    if (waitUntil) waitUntil(rebuild);
    return cached;
  }

  // Cold miss. If someone else is rebuilding, wait for them rather than
  // either returning empty or piling on a duplicate O(N) rebuild.
  if (await kv.get(BUILDING_KEY)) {
    const waited = await pollForCache(kv);
    if (waited) return waited;
    // Rebuild didn't finish in time — fall through and rebuild ourselves
    // rather than show the user an empty page.
  }

  // Claim the rebuild with a sentinel (best-effort).
  try {
    await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
  } catch {
    // If sentinel write fails, proceed anyway — worst case is a duplicate rebuild
  }

  try {
    return await rebuildAgentListCache(kv);
  } finally {
    await kv.delete(BUILDING_KEY).catch(() => {});
  }
}

async function pollForCache(
  kv: KVNamespace
): Promise<CachedAgentList | null> {
  const deadline = Date.now() + COLD_MISS_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COLD_MISS_POLL_INTERVAL_MS));
    const snapshot = parseSnapshot(await kv.get(CACHE_KEY));
    if (snapshot) return snapshot;
  }
  return null;
}

async function maybeTriggerBackgroundRebuild(
  kv: KVNamespace
): Promise<void> {
  // Only one background rebuild at a time.
  if (await kv.get(BUILDING_KEY)) return;
  try {
    await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
  } catch {
    return;
  }
  try {
    await rebuildAgentListCache(kv);
  } catch {
    // Swallow — the stale snapshot is already being served.
  } finally {
    await kv.delete(BUILDING_KEY).catch(() => {});
  }
}

/**
 * Invalidate the cached agent list so the next read returns the stale
 * snapshot (and triggers a background rebuild) instead of forcing a
 * cold-miss synchronous rebuild.
 *
 * Mark-stale shifts cachedAt past FRESH_WINDOW_SECONDS but keeps the
 * snapshot inside CACHE_TTL_SECONDS, so getCachedAgentList sees it as
 * stale, returns it immediately, and kicks off maybeTriggerBackgroundRebuild.
 *
 * If there's no existing snapshot, this is a no-op (next read will cold-miss
 * + rebuild as before).
 */
export async function invalidateAgentListCache(
  kv: KVNamespace
): Promise<void> {
  try {
    const raw = await kv.get(CACHE_KEY);
    if (raw && !parseSnapshot(raw)) {
      // Corrupt entry — clean up immediately rather than leaving it for the
      // next getCachedAgentList call to find.
      await kv.delete(CACHE_KEY).catch(() => {});
      return;
    }
    const cached = parseSnapshot(raw);
    if (!cached) return;

    const stalePastFresh = new Date(
      Date.now() - (FRESH_WINDOW_SECONDS + 1) * 1000
    ).toISOString();

    // Optimistic re-check: if maybeTriggerBackgroundRebuild finished between
    // our read and now, skip the mark-stale put — the new snapshot is already
    // current and we'd otherwise clobber it with a stale-shifted S_old.
    const rawAgain = await kv.get(CACHE_KEY);
    const cachedAgain = parseSnapshot(rawAgain);
    if (cachedAgain && cachedAgain.cachedAt > cached.cachedAt) return;

    await kv.put(
      CACHE_KEY,
      JSON.stringify({ ...cached, cachedAt: stalePastFresh }),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  } catch {
    // Best-effort
  }
}

/**
 * Rebuild the agent list cache from individual KV records.
 * This is the expensive operation that the cache avoids on every page load.
 *
 * The agent set is sourced from the maintained `agents:index`
 * (single KV read) instead of `kv.list({prefix:"stx:"}) + N gets` —
 * full AgentRecords are still fetched per agent for the auxiliary
 * fields (description, owner, lastActiveAt, …) the snapshot needs.
 *
 * Concurrency: per-record fetches are batched to bound peak
 * concurrent KV reads + JSON parses. The previous `kv.list`
 * implementation was already bounded by KV's 1000-keys-per-page
 * cap; sourcing from the index removed that natural bound, so we
 * re-impose one explicitly here.
 */
const REBUILD_FETCH_BATCH_SIZE = 500;

async function rebuildAgentListCache(
  kv: KVNamespace
): Promise<CachedAgentList> {
  // 1. Source agent addresses from the maintained index.
  const index = await getAgentsIndex(kv);

  // 2. Fetch full AgentRecords by `btc:`, batched to keep peak
  //    concurrency in line with the prior `kv.list` per-page bound.
  const agents: AgentRecord[] = [];
  for (let i = 0; i < index.agents.length; i += REBUILD_FETCH_BATCH_SIZE) {
    const batch = index.agents.slice(i, i + REBUILD_FETCH_BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(async (entry) => {
        const value = await kv.get(`btc:${entry.btcAddress}`);
        if (!value) return null;
        try {
          return JSON.parse(value) as AgentRecord;
        } catch {
          return null;
        }
      })
    );
    for (const record of fetched) {
      if (record) agents.push(record);
    }
  }

  // 2. Enrich: claims, inbox in parallel.
  const [claims, inboxData] = await Promise.all([
    Promise.all(
      agents.map(async (agent) => {
        const data = await kv.get(`claim:${agent.btcAddress}`);
        if (!data) return null;
        try {
          return JSON.parse(data) as ClaimStatus;
        } catch {
          return null;
        }
      })
    ),
    Promise.all(
      agents.map(async (agent) => {
        const data = await kv.get(`inbox:agent:${agent.btcAddress}`);
        if (!data) return null;
        try {
          return JSON.parse(data) as {
            messageIds: string[];
            unreadCount: number;
          };
        } catch {
          return null;
        }
      })
    ),
  ]);

  // 3. Build cached agents
  const cachedAgents: CachedAgent[] = agents.map((agent, i) => {
    const level = computeLevel(agent, claims[i]);
    const inbox = inboxData[i];
    return {
      stxAddress: agent.stxAddress,
      btcAddress: agent.btcAddress,
      stxPublicKey: agent.stxPublicKey,
      btcPublicKey: agent.btcPublicKey,
      taprootAddress: agent.taprootAddress ?? null,
      displayName: agent.displayName ?? null,
      description: agent.description ?? null,
      bnsName: agent.bnsName ?? null,
      owner: agent.owner ?? null,
      verifiedAt: agent.verifiedAt,
      lastActiveAt: agent.lastActiveAt ?? null,
      erc8004AgentId: agent.erc8004AgentId ?? null,
      nostrPublicKey: agent.nostrPublicKey ?? null,
      lastIdentityCheck: agent.lastIdentityCheck ?? null,
      referredBy: agent.referredBy ?? null,
      githubUsername: agent.githubUsername ?? null,
      level,
      levelName: LEVELS[level].name,
      messageCount: inbox?.messageIds.length ?? 0,
      unreadCount: inbox?.unreadCount ?? 0,
    };
  });

  const genesisCount = cachedAgents.filter((a) => a.level >= 2).length;

  // Derive total message count from already-fetched inbox data
  // (avoids a separate O(M) kv.list scan over inbox:message:* keys)
  const messageCount = inboxData.reduce(
    (sum, inbox) => sum + (inbox?.messageIds.length ?? 0),
    0
  );

  const snapshot: CachedAgentList = {
    agents: cachedAgents,
    stats: {
      total: cachedAgents.length,
      genesisCount,
      messageCount,
    },
    cachedAt: new Date().toISOString(),
  };

  // Store with TTL (awaited to ensure persistence in Workers runtime).
  // Size ceiling: CachedAgent ~500 bytes/agent. KV max value = 25MB → ~50k agent ceiling.
  // Above that, consider paginated cache shards or D1/Durable Objects.
  try {
    await kv.put(CACHE_KEY, JSON.stringify(snapshot), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {
    // Best-effort — snapshot is still returned even if write fails
  }

  return snapshot;
}
