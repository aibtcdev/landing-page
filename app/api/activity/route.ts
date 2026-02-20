import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import type { InboxAgentIndex, InboxMessage } from "@/lib/inbox/types";
import type { AchievementAgentIndex, AchievementRecord } from "@/lib/achievements/types";
import { ACHIEVEMENTS } from "@/lib/achievements/registry";

/**
 * Activity event types that can appear in the network feed.
 */
type ActivityEventType = "message" | "achievement" | "registration";

/**
 * A single activity event in the network feed.
 */
interface ActivityEvent {
  type: ActivityEventType;
  timestamp: string;
  agent: {
    btcAddress: string;
    displayName: string;
  };
  // For messages
  recipient?: {
    btcAddress: string;
    displayName: string;
  };
  paymentSatoshis?: number;
  messagePreview?: string;
  // For achievements
  achievementId?: string;
  achievementName?: string;
}

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
 * Response format for GET /api/activity.
 */
interface ActivityResponse {
  events: ActivityEvent[];
  stats: NetworkStats;
}

/**
 * Cached activity data stored at `cache:activity` in KV.
 */
interface CachedActivity {
  data: ActivityResponse;
  cachedAt: string;
}

const CACHE_KEY = "cache:activity";
const CACHE_TTL_SECONDS = 120; // 2 minutes
const MAX_EVENTS = 20;
const TOP_ACTIVE_AGENTS = 20;
const ACTIVE_DAYS_THRESHOLD = 7;

/**
 * GET /api/activity
 *
 * Returns recent network activity (messages, achievements, registrations)
 * and aggregate statistics (total agents, active agents, messages, sats).
 *
 * Caches result in KV for 2 minutes to avoid expensive scans on every page load.
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
        description: "Response is cached in KV for 2 minutes to prevent expensive scans on every page load",
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
          },
        });
      }
    }

    // Cache miss or stale — regenerate activity feed
    const agents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    // List all agents (same pattern as /api/agents)
    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({
        prefix: "stx:",
        cursor,
      });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;

      const values = await Promise.all(
        listResult.keys.map(async (key) => {
          const value = await kv.get(key.name);
          if (!value) return null;
          try {
            return JSON.parse(value) as AgentRecord;
          } catch (e) {
            console.error(`Failed to parse agent record ${key.name}:`, e);
            return null;
          }
        })
      );
      agents.push(...values.filter((v): v is AgentRecord => v !== null));
    }

    // Compute aggregate stats
    const now = Date.now();
    const activeCutoff = now - ACTIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
    const activeAgents = agents.filter((agent) => {
      if (!agent.lastActiveAt) return false;
      return new Date(agent.lastActiveAt).getTime() >= activeCutoff;
    });

    // Sort agents by lastActiveAt descending, take top N most active
    const sortedAgents = [...agents]
      .filter((a) => a.lastActiveAt)
      .sort((a, b) => {
        const aTime = new Date(a.lastActiveAt!).getTime();
        const bTime = new Date(b.lastActiveAt!).getTime();
        return bTime - aTime;
      })
      .slice(0, TOP_ACTIVE_AGENTS);

    // Compute network-wide totals from ALL agents' inbox indices.
    // The stats:totalSatsTransacted KV counter is incremented on each successful
    // inbox payment, so we read it directly instead of estimating from message counts.
    let totalMessages = 0;

    const [allInboxResults, satsCounterRaw] = await Promise.all([
      Promise.all(
        agents.map(async (agent) => {
          const inboxIndex = await kv.get<InboxAgentIndex>(
            `inbox:agent:${agent.btcAddress}`,
            "json"
          );
          return inboxIndex ? inboxIndex.messageIds.length : 0;
        })
      ),
      kv.get("stats:totalSatsTransacted"),
    ]);

    for (const count of allInboxResults) {
      totalMessages += count;
    }

    // Use the real KV counter when available; fall back to scan-based estimate
    // for environments where the counter has not yet been seeded.
    const SATS_PER_MESSAGE_ESTIMATE = 100;

    let totalSatsTransacted: number;
    if (typeof satsCounterRaw === "string") {
      const parsed = parseInt(satsCounterRaw, 10);
      totalSatsTransacted = Number.isNaN(parsed)
        ? totalMessages * SATS_PER_MESSAGE_ESTIMATE
        : parsed;
    } else {
      totalSatsTransacted = totalMessages * SATS_PER_MESSAGE_ESTIMATE;
    }

    // Collect events from top active agents
    const events: ActivityEvent[] = [];

    // Fetch inbox and achievement indices for top active agents
    const eventPromises = sortedAgents.map(async (agent) => {
      const agentEvents: ActivityEvent[] = [];

      // Fetch inbox index (may re-fetch for top agents, but cached by runtime)
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

            // Find sender agent for display name
            const senderAgent = agents.find(
              (a) => a.stxAddress === message.fromAddress
            );

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
      totalAgents: agents.length,
      activeAgents: activeAgents.length,
      totalMessages,
      totalSatsTransacted,
    };

    const response: ActivityResponse = {
      events: sortedEvents,
      stats,
    };

    // Cache the response
    const cacheData: CachedActivity = {
      data: response,
      cachedAt: new Date().toISOString(),
    };
    await kv.put(CACHE_KEY, JSON.stringify(cacheData), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Failed to fetch activity:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch network activity",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
