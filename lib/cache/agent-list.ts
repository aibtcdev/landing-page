/**
 * KV-backed cache for the enriched agent list.
 *
 * Replaces O(N) KV scans on every page load with a single KV read.
 * The snapshot is rebuilt on cache miss and stored with a 2-minute TTL.
 * Mutation endpoints call invalidateAgentListCache() to force a rebuild.
 */

import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { getAchievementCount } from "@/lib/achievements";
import type { CachedAgent, CachedAgentList } from "./types";

const CACHE_KEY = "cache:agent-list";
const CACHE_TTL_SECONDS = 120; // 2 minutes

/**
 * Get the cached agent list from KV, rebuilding if stale or missing.
 */
export async function getCachedAgentList(
  kv: KVNamespace
): Promise<CachedAgentList> {
  // Try cache first
  const cached = await kv.get(CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedAgentList;
    } catch {
      // Corrupted cache — delete before rebuilding to prevent repeated parse failures
      await kv.delete(CACHE_KEY).catch(() => {});
    }
  }

  // Cache miss — rebuild from KV
  return rebuildAgentListCache(kv);
}

/**
 * Invalidate the cached agent list so the next read triggers a rebuild.
 */
export async function invalidateAgentListCache(
  kv: KVNamespace
): Promise<void> {
  try {
    await kv.delete(CACHE_KEY);
  } catch {
    // Best-effort deletion
  }
}

/**
 * Rebuild the agent list cache from individual KV records.
 * This is the expensive operation that the cache avoids on every page load.
 */
async function rebuildAgentListCache(
  kv: KVNamespace
): Promise<CachedAgentList> {
  // 1. List all agent keys
  const agents: AgentRecord[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const page = await kv.list({ prefix: "stx:", cursor });
    listComplete = page.list_complete;
    cursor = !page.list_complete ? page.cursor : undefined;

    const values = await Promise.all(
      page.keys.map(async (key) => {
        const value = await kv.get(key.name);
        if (!value) return null;
        try {
          return JSON.parse(value) as AgentRecord;
        } catch {
          return null;
        }
      })
    );
    agents.push(...values.filter((v): v is AgentRecord => v !== null));
  }

  // 2. Enrich: claims, achievements, inbox in parallel
  const [claims, achievementCounts, inboxData] = await Promise.all([
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
      agents.map((agent) => getAchievementCount(kv, agent.btcAddress))
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

  // 3. Count messages (separate prefix scan)
  let messageCount = 0;
  let msgCursor: string | undefined;
  let msgComplete = false;
  while (!msgComplete) {
    const page = await kv.list({ prefix: "inbox:message:", cursor: msgCursor });
    messageCount += page.keys.length;
    msgComplete = page.list_complete;
    msgCursor = !page.list_complete ? page.cursor : undefined;
  }

  // 4. Build cached agents
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
      checkInCount: agent.checkInCount ?? 0,
      erc8004AgentId: agent.erc8004AgentId ?? null,
      nostrPublicKey: agent.nostrPublicKey ?? null,
      lastIdentityCheck: agent.lastIdentityCheck ?? null,
      referredBy: agent.referredBy ?? null,
      githubUsername: agent.githubUsername ?? null,
      level,
      levelName: LEVELS[level].name,
      achievementCount: achievementCounts[i],
      messageCount: inbox?.messageIds.length ?? 0,
      unreadCount: inbox?.unreadCount ?? 0,
    };
  });

  const genesisCount = cachedAgents.filter((a) => a.level >= 2).length;

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
