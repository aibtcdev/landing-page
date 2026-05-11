/**
 * Activity feed data builder.
 *
 * Extracted from app/api/activity/route.ts so both the API route and
 * the home page (app/page.tsx) can import it without coupling to the
 * route handler module.
 */

import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import { listInboxMessagesFromD1 } from "@/lib/inbox/d1-reads";
import { getCachedAgentList } from "@/lib/cache";
import type { ActivityEvent, ActivityResponse } from "@/app/components/activity-shared";

const MAX_EVENTS = 40;
const TOP_ACTIVE_AGENTS = 20;
const ACTIVE_DAYS_THRESHOLD = 7;

/**
 * Assemble activity data using the shared agent-list cache.
 *
 * Uses getCachedAgentList() (single KV read on cache hit) instead of
 * an independent O(N) KV scan. Per-agent recent-message fetches now read
 * from D1 via `listInboxMessagesFromD1` (one query/agent, ordered by
 * sent_at DESC LIMIT 3) — collapses the previous 4 KV reads/agent
 * (inbox:agent index + 3 inbox:message lookups) to a single SELECT.
 *
 * When `db` is undefined (legacy / test paths), message events are
 * skipped rather than reading stale KV indexes (KV inbox writes were
 * removed in #730 Step 4 / PR #745). Registration events still surface.
 */
export async function buildActivityData(
  kv: KVNamespace,
  db: D1Database | undefined
): Promise<ActivityResponse> {
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
  // One D1 query/agent (LIMIT 3 ORDER BY sent_at DESC) replaces the prior
  // 4 KV reads/agent (inbox:agent index + 3 inbox:message lookups).
  const eventPromises = sortedAgents.map(async (agent) => {
    const agentEvents: ActivityEvent[] = [];

    if (db) {
      // listInboxMessagesFromD1 returns most-recent first (ORDER BY sent_at DESC)
      const messages = await listInboxMessagesFromD1(
        db,
        agent.btcAddress,
        3,
        0,
        "all"
      );

      for (const message of messages) {
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
