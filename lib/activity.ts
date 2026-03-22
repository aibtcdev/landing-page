/**
 * Activity feed data builder.
 *
 * Extracted from app/api/activity/route.ts so both the API route and
 * the home page (app/page.tsx) can import it without coupling to the
 * route handler module.
 */

import type { InboxMessage, InboxAgentIndex } from "@/lib/inbox/types";
import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import type { AchievementAgentIndex, AchievementRecord } from "@/lib/achievements/types";
import { ACHIEVEMENTS } from "@/lib/achievements/registry";
import { getCachedAgentList } from "@/lib/cache";
import type { ActivityEvent, ActivityResponse } from "@/app/components/activity-shared";

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

  return {
    events: sortedEvents,
    stats: {
      totalAgents: agentStats.total,
      activeAgents: activeAgents.length,
      totalMessages,
      totalSatsTransacted,
    },
  };
}
