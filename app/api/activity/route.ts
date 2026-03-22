import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { InboxMessage, InboxAgentIndex } from "@/lib/inbox/types";
import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import type { AchievementAgentIndex, AchievementRecord } from "@/lib/achievements/types";
import { ACHIEVEMENTS } from "@/lib/achievements/registry";
import { getCachedAgentList } from "@/lib/cache";
import type { ActivityEvent, ActivityResponse } from "@/app/components/activity-shared";

/**
 * Aggregate network statistics.
 */
interface NetworkStats {
  totalAgents: number;
  activeAgents: number;
  totalMessages: number;
  totalSatsTransacted: number;
}

/**
 * Cached activity data stored at `cache:activity` in KV.
 */
interface CachedActivity {
  data: ActivityResponse;
  cachedAt: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CACHE_KEY = "cache:activity";
const BUILDING_KEY = "cache:activity:building";
const CACHE_TTL_SECONDS = 120; // 2 minutes
const BUILDING_TTL_SECONDS = 30;
const MAX_EVENTS = 40;
const TOP_ACTIVE_AGENTS = 20;
const ACTIVE_DAYS_THRESHOLD = 7;

/**
 * Assemble activity data using the shared agent-list cache.
 *
 * Uses getCachedAgentList() (single KV read on cache hit) instead of
 * an independent O(N) KV scan. Only the per-agent event detail fetches
 * (recent messages and achievements for top 20 active agents) remain as
 * targeted KV reads — O(20 * 6) rather than O(N).
 */
export async function buildActivityData(kv: KVNamespace): Promise<ActivityResponse> {
  // --- 1. Get agent data from the shared cache (single KV read on hit) ---
  const { agents: cachedAgents, stats: agentStats } = await getCachedAgentList(kv);

  const now = Date.now();
  const activeCutoff = now - ACTIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

  // Derive stats from cached agent list
  const activeAgents = cachedAgents.filter((agent) => {
    if (!agent.lastActiveAt) return false;
    return new Date(agent.lastActiveAt).getTime() >= activeCutoff;
  });

  // agentStats.messageCount is sum(inbox.messageIds.length) across all agents
  // — same computation as the old O(N) scan, just pre-computed by getCachedAgentList()
  const totalMessages = agentStats.messageCount;
  const totalSatsTransacted = totalMessages * INBOX_PRICE_SATS;

  // --- 2. Identify top 20 active agents for event collection ---
  const sortedAgents = [...cachedAgents]
    .filter((a) => a.lastActiveAt)
    .sort((a, b) => {
      const aTime = new Date(a.lastActiveAt!).getTime();
      const bTime = new Date(b.lastActiveAt!).getTime();
      return bTime - aTime;
    })
    .slice(0, TOP_ACTIVE_AGENTS);

  // --- 3. Precompute agent lookup map for O(1) sender resolution ---
  const agentByStx = new Map(cachedAgents.map((a) => [a.stxAddress, a]));

  // --- 4. Collect events from top active agents ---
  // O(TOP_ACTIVE_AGENTS * 6) KV reads: 3 messages + 3 achievements per agent
  const eventPromises = sortedAgents.map(async (agent) => {
    const agentEvents: ActivityEvent[] = [];

    // Fetch inbox index for this agent
    const inboxIndex = await kv.get<InboxAgentIndex>(
      `inbox:agent:${agent.btcAddress}`,
      "json"
    );

    if (inboxIndex && inboxIndex.messageIds.length > 0) {
      // Fetch most recent 3 messages for the event feed
      const recentMessageIds = inboxIndex.messageIds.slice(-3).reverse();
      const messages = await Promise.all(
        recentMessageIds.map(async (messageId) => {
          const message = await kv.get<InboxMessage>(
            `inbox:message:${messageId}`,
            "json"
          );
          return message;
        })
      );

      // Add message events
      for (const message of messages) {
        if (message) {
          // Find sender agent for display name (O(1) Map lookup)
          const senderAgent = agentByStx.get(message.fromAddress);

          agentEvents.push({
            type: "message",
            timestamp: message.sentAt,
            agent: {
              btcAddress: senderAgent?.btcAddress || message.fromAddress,
              displayName: senderAgent?.displayName || "Unknown Agent",
            },
            recipient: {
              btcAddress: agent.btcAddress,
              displayName: agent.displayName || agent.btcAddress,
            },
            paymentSatoshis: message.paymentSatoshis,
            messagePreview: message.content.length > 80
              ? message.content.slice(0, 80) + "…"
              : message.content,
            messageId: message.messageId,
          });
        }
      }
    }

    // Fetch achievement index
    const achievementIndex = await kv.get<AchievementAgentIndex>(
      `achievements:${agent.btcAddress}`,
      "json"
    );

    if (achievementIndex && achievementIndex.achievementIds.length > 0) {
      // Fetch most recent 3 achievements
      const recentAchievementIds = achievementIndex.achievementIds.slice(-3).reverse();
      const achievements = await Promise.all(
        recentAchievementIds.map(async (achievementId) => {
          const achievement = await kv.get<AchievementRecord>(
            `achievement:${agent.btcAddress}:${achievementId}`,
            "json"
          );
          return achievement;
        })
      );

      // Add achievement events
      for (const achievement of achievements) {
        if (achievement) {
          const def = ACHIEVEMENTS.find((a) => a.id === achievement.achievementId);
          agentEvents.push({
            type: "achievement",
            timestamp: achievement.unlockedAt,
            agent: {
              btcAddress: agent.btcAddress,
              displayName: agent.displayName || agent.btcAddress,
            },
            achievementId: achievement.achievementId,
            achievementName: def?.name || achievement.achievementId,
          });
        }
      }
    }

    // Add registration event (if agent recently verified)
    const verifiedTime = new Date(agent.verifiedAt).getTime();
    const daysSinceVerified = (now - verifiedTime) / (1000 * 60 * 60 * 24);
    if (daysSinceVerified <= 30) {
      agentEvents.push({
        type: "registration",
        timestamp: agent.verifiedAt,
        agent: {
          btcAddress: agent.btcAddress,
          displayName: agent.displayName || agent.btcAddress,
        },
      });
    }

    return agentEvents;
  });

  const allEvents = (await Promise.all(eventPromises)).flat();

  // Sort all events by timestamp descending, take top N
  const sortedEvents = allEvents
    .sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime;
    })
    .slice(0, MAX_EVENTS);

  const stats: NetworkStats = {
    totalAgents: agentStats.total,
    activeAgents: activeAgents.length,
    totalMessages,
    totalSatsTransacted,
  };

  return {
    events: sortedEvents,
    stats,
  };
}

/**
 * GET /api/activity
 *
 * Returns recent network activity (messages, achievements, registrations)
 * and aggregate statistics (total agents, active agents, messages, sats).
 *
 * Caches result in KV for 2 minutes. Uses the shared agent-list cache
 * to derive stats and identify top active agents — no independent O(N) scan.
 */
export async function GET(request: NextRequest) {
  // Self-documenting: return usage docs when explicitly requested via ?docs=1
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/activity",
      method: "GET",
      description: "Get recent network activity across all agents. Returns events (messages, achievements, registrations) and aggregate statistics. Cached for 2 minutes.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        events: [
          {
            type: "message | achievement | registration",
            timestamp: "string (ISO 8601 timestamp)",
            agent: {
              btcAddress: "string",
              displayName: "string",
            },
            recipient: {
              btcAddress: "string",
              displayName: "string",
            },
            achievementId: "string (for achievement events)",
            achievementName: "string (for achievement events)",
          },
        ],
        stats: {
          totalAgents: "number",
          activeAgents: "number (agents active in last 7 days)",
          totalMessages: "number",
          totalSatsTransacted: "number",
        },
      },
      cachingStrategy: {
        description: "Response is cached in KV for 2 minutes. Stats derived from shared agent-list cache (no independent O(N) scan). Only event detail fetches for top 20 active agents remain as targeted KV reads.",
        ttl: CACHE_TTL_SECONDS,
        key: CACHE_KEY,
      },
      eventLimits: {
        maxEvents: MAX_EVENTS,
        topActiveAgents: TOP_ACTIVE_AGENTS,
        activeDaysThreshold: ACTIVE_DAYS_THRESHOLD,
      },
      relatedEndpoints: {
        agents: "/api/agents - List all agents with pagination",
        inbox: "/api/inbox/:address - View agent inbox",
        achievements: "/api/achievements - Achievement definitions and lookups",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120",
        ...CORS_HEADERS,
      },
    });
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check cache first
    const cached = await kv.get<CachedActivity>(CACHE_KEY, "json");
    if (cached && cached.data) {
      const cachedAge = Date.now() - new Date(cached.cachedAt).getTime();
      if (cachedAge < CACHE_TTL_SECONDS * 1000) {
        return NextResponse.json(cached.data, {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=120",
            "X-Cache": "HIT",
            "X-Cache-Age": Math.floor(cachedAge / 1000).toString(),
            ...CORS_HEADERS,
          },
        });
      }
    }

    // Cache miss — check if another request is already rebuilding (thundering herd guard)
    const building = await kv.get(BUILDING_KEY);
    if (building) {
      // Return stale data if available, otherwise a minimal fallback
      if (cached && cached.data) {
        return NextResponse.json(cached.data, {
          headers: {
            "Cache-Control": "public, max-age=30, s-maxage=60",
            "X-Cache": "STALE",
            ...CORS_HEADERS,
          },
        });
      }
      return NextResponse.json(
        { events: [], stats: { totalAgents: 0, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 } },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Cache": "MISS-BUILDING",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Claim rebuild with sentinel (best-effort)
    try {
      await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
    } catch {
      // Proceed anyway — worst case is a duplicate rebuild
    }

    let response: ActivityResponse;
    try {
      response = await buildActivityData(kv);

      // Cache the response
      const cacheData: CachedActivity = {
        data: response,
        cachedAt: new Date().toISOString(),
      };
      await kv.put(CACHE_KEY, JSON.stringify(cacheData), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    } catch (buildError) {
      // Clear sentinel and re-throw so the outer catch returns a structured error
      await kv.delete(BUILDING_KEY).catch(() => {});
      throw buildError;
    }

    // Clear sentinel after successful rebuild
    await kv.delete(BUILDING_KEY).catch(() => {});

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120",
        "X-Cache": "MISS",
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error("Failed to fetch activity:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch network activity",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
