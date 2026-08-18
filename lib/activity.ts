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
 *
 * Issue #1058: the message half of the feed is now a single global query
 * instead of a fan-out over the top-20 most-recently-active recipients. See
 * `buildActivityData` for why.
 */

import type { InboxMessage } from "@/lib/inbox/types";
import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import { getRecentGlobalInboxEventsFromD1 } from "@/lib/inbox/d1-reads";
import { getCachedAgentList } from "@/lib/cache";
import type { ActivityEvent, ActivityResponse } from "@/app/components/activity-shared";

const MAX_EVENTS = 40;
const ACTIVE_DAYS_THRESHOLD = 7;
const REGISTRATION_WINDOW_DAYS = 30;

/**
 * Assemble activity data using the shared agent-list cache.
 *
 * Uses getCachedAgentList() (single KV read on cache hit) for stats and for
 * resolving addresses to display names. Message events come from one global
 * D1 query (`getRecentGlobalInboxEventsFromD1`).
 *
 * The previous shape collected messages by fanning out over the 20
 * most-recently-active agents and reading each one's 3 newest inbound
 * messages. That made the feed recipient-scoped: a message sent *to* a
 * dormant agent (reactivation outreach, say) could never appear, because
 * its recipient never made the top-20 cut. Reported as "the feed is frozen"
 * (#1058), since a quiet stretch among the currently-active 20 pins the
 * newest visible event in place while messages keep landing elsewhere.
 * Taking the newest N messages network-wide removes both the blind spot and
 * the 20-query fan-out.
 *
 * Registrations likewise come from the whole agent list within
 * REGISTRATION_WINDOW_DAYS rather than from the top-20 slice.
 *
 * @param kv - VERIFIED_AGENTS KV namespace (agent-list cache layer)
 * @param db - D1 database binding for live inbox event reads (#746).
 *   Pass undefined to skip message events (fail-open).
 */
export async function buildActivityData(kv: KVNamespace, db?: D1Database): Promise<ActivityResponse> {
  // --- 1. Get agent data from the shared cache (single KV read on hit) ---
  const { agents: cachedAgents, stats: agentStats } = await getCachedAgentList(kv);

  const now = Date.now();
  const activeCutoff = now - ACTIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
  const registrationCutoff = now - REGISTRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Derive stats from cached agent list
  const activeAgents = cachedAgents.filter((agent) => {
    if (!agent.lastActiveAt) return false;
    return new Date(agent.lastActiveAt).getTime() >= activeCutoff;
  });

  // agentStats.messageCount is sum(inbox.messageIds.length) across all agents
  // — same computation as the old O(N) scan, just pre-computed by getCachedAgentList()
  const totalMessages = agentStats.messageCount;
  const totalSatsTransacted = totalMessages * INBOX_PRICE_SATS;

  // --- 2. Address → agent maps for O(1) display-name resolution ---
  // Senders are identified by STX address on the message row, recipients by
  // BTC address. Both sides may be unregistered, hence the fallbacks below.
  const agentByStx = new Map(cachedAgents.map((a) => [a.stxAddress, a]));
  const agentByBtc = new Map(cachedAgents.map((a) => [a.btcAddress, a]));

  // --- 3. Message events: newest MAX_EVENTS network-wide, one D1 query ---
  // Returns [] when db is undefined or on D1 error (fail-open).
  const messages: InboxMessage[] = await getRecentGlobalInboxEventsFromD1(db, MAX_EVENTS);

  const messageEvents: ActivityEvent[] = messages.map((message) => {
    const senderAgent = agentByStx.get(message.fromAddress);
    const recipientAgent = agentByBtc.get(message.toBtcAddress);

    return {
      type: "message",
      timestamp: message.sentAt,
      agent: {
        btcAddress: senderAgent?.btcAddress || message.fromAddress,
        displayName: senderAgent?.displayName || "Unknown Agent",
      },
      recipient: {
        btcAddress: message.toBtcAddress,
        displayName: recipientAgent?.displayName || message.toBtcAddress,
      },
      paymentSatoshis: message.paymentSatoshis,
      messagePreview: message.content.length > 80
        ? message.content.slice(0, 80) + "…"
        : message.content,
      messageId: message.messageId,
    };
  });

  // --- 4. Registration events: every agent verified in the last 30 days ---
  const registrationEvents: ActivityEvent[] = cachedAgents
    .filter((agent) => {
      const verifiedTime = new Date(agent.verifiedAt).getTime();
      return !Number.isNaN(verifiedTime) && verifiedTime >= registrationCutoff;
    })
    .map((agent) => ({
      type: "registration" as const,
      timestamp: agent.verifiedAt,
      agent: {
        btcAddress: agent.btcAddress,
        displayName: agent.displayName || agent.btcAddress,
      },
    }));

  // Sort all events by timestamp descending, take top N
  const sortedEvents = [...messageEvents, ...registrationEvents]
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
