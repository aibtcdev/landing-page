/**
 * Activity feed data builder.
 *
 * Extracted from app/api/activity/route.ts so both the API route and
 * the home page (app/page.tsx) can import it without coupling to the
 * route handler module.
 *
 * Phase 2.5 #746 — inbox reads switched from KV (`inbox:agent:*` /
 * `inbox:message:*`) to D1 via `getRecentInboxEventsFromD1`. The KV
 * index stopped being written after Step 4 (#730, merged 2026-05-11T14:24Z),
 * so KV reads served frozen-at-cutover data for new messages. The D1 path
 * returns live events. `db` is optional — when undefined the per-agent event
 * collection returns empty (fail-open; stats from the agent-list cache still
 * render correctly).
 */

import type { InboxMessage } from "@/lib/inbox/types";
import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import { getRecentInboxEventsFromD1 } from "@/lib/inbox/d1-reads";
import { getCachedAgentList } from "@/lib/cache";
import type { ActivityEvent, ActivityResponse } from "@/app/components/activity-shared";

const MAX_EVENTS = 40;
const TOP_ACTIVE_AGENTS = 20;
const ACTIVE_DAYS_THRESHOLD = 7;

/**
 * Assemble activity data using the shared agent-list cache.
 *
 * Uses getCachedAgentList() (single KV read on cache hit) instead of
 * an independent O(N) KV scan. Per-agent event detail fetches use D1
 * (`getRecentInboxEventsFromD1`) instead of the frozen-at-Step-4 KV index
 * reads — O(20) D1 queries each selecting up to 3 rows, rather than
 * O(20 * 1 KV + 20 * 3 KV). When `db` is undefined the event collection
 * falls back to empty (fail-open), but stats still render from the cache.
 *
 * @param kv - VERIFIED_AGENTS KV namespace (agent-list cache layer)
 * @param db - D1 database binding for live inbox event reads (#746).
 *   Pass undefined to skip per-agent event collection (fail-open).
 */
export async function buildActivityData(kv: KVNamespace, db?: D1Database): Promise<ActivityResponse> {
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
  // O(TOP_ACTIVE_AGENTS) D1 queries, each selecting up to 3 rows.
  // Replaces the two-step KV pattern (inbox:agent:{btcAddress} index read +
  // per-message inbox:message:{id} reads) that served frozen-at-Step-4 data.
  // When db is undefined, per-agent message events are empty (fail-open).
  const eventPromises = sortedAgents.map(async (agent) => {
    const agentEvents: ActivityEvent[] = [];

    // Fetch 3 most recent inbound messages for this agent from D1.
    // Returns [] when db is undefined or on D1 error (fail-open).
    const messages: InboxMessage[] = await getRecentInboxEventsFromD1(db, agent.btcAddress, 3);

    // Add message events
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
