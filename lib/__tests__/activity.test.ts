/**
 * Tests for buildActivityData, issue #1058.
 *
 * The regression under test: the feed used to collect message events by
 * fanning out over the 20 most-recently-active agents and reading each
 * one's newest inbound messages, so a message to a dormant recipient was
 * structurally invisible and the feed looked frozen. These tests pin the
 * global-query behaviour that replaced it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InboxMessage } from "@/lib/inbox/types";
import type { CachedAgent, CachedAgentList } from "@/lib/cache/types";

const getCachedAgentListMock = vi.fn();
const getRecentGlobalInboxEventsFromD1Mock = vi.fn();

vi.mock("@/lib/cache", () => ({
  getCachedAgentList: (...args: unknown[]) => getCachedAgentListMock(...args),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  getRecentGlobalInboxEventsFromD1: (...args: unknown[]) =>
    getRecentGlobalInboxEventsFromD1Mock(...args),
}));

import { buildActivityData } from "../activity";

const kv = {} as KVNamespace;
const db = {} as D1Database;

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();

function agent(overrides: Partial<CachedAgent>): CachedAgent {
  return {
    stxAddress: "SP_DEFAULT",
    btcAddress: "bc1_default",
    stxPublicKey: "",
    btcPublicKey: "",
    taprootAddress: null,
    displayName: null,
    description: null,
    bnsName: null,
    owner: null,
    verifiedAt: iso(200 * DAY_MS),
    lastActiveAt: null,
    erc8004AgentId: null,
    nostrPublicKey: null,
    lastIdentityCheck: null,
    referredBy: null,
    githubUsername: null,
    level: 1,
    levelName: "Registered",
    messageCount: 0,
    unreadCount: 0,
    ...overrides,
  } as CachedAgent;
}

function message(overrides: Partial<InboxMessage>): InboxMessage {
  return {
    messageId: "msg_default",
    fromAddress: "SP_SENDER",
    toBtcAddress: "bc1_recipient",
    toStxAddress: "SP_RECIPIENT",
    content: "hello",
    paymentSatoshis: 100,
    sentAt: iso(60 * 1000),
    authenticated: true,
    ...overrides,
  } as InboxMessage;
}

function cacheSnapshot(agents: CachedAgent[]): CachedAgentList {
  return {
    agents,
    stats: {
      total: agents.length,
      genesisCount: agents.filter((a) => a.level >= 2).length,
      messageCount: agents.reduce((sum, a) => sum + a.messageCount, 0),
    },
    cachedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  getCachedAgentListMock.mockReset();
  getRecentGlobalInboxEventsFromD1Mock.mockReset();
  getRecentGlobalInboxEventsFromD1Mock.mockResolvedValue([]);
});

describe("buildActivityData", () => {
  it("surfaces a message to a dormant recipient (the #1058 blind spot)", async () => {
    const sender = agent({
      stxAddress: "SP_SENDER",
      btcAddress: "bc1_sender",
      displayName: "Tiny Marten",
      lastActiveAt: iso(60 * 1000),
    });
    // Recipient has not checked in for a year. Under the old top-20-active
    // fan-out this message could never appear in the feed.
    const dormant = agent({
      stxAddress: "SP_DORMANT",
      btcAddress: "bc1_dormant",
      displayName: "Dormant Agent",
      lastActiveAt: iso(365 * DAY_MS),
    });

    getCachedAgentListMock.mockResolvedValue(cacheSnapshot([sender, dormant]));
    getRecentGlobalInboxEventsFromD1Mock.mockResolvedValue([
      message({
        messageId: "msg_outreach",
        fromAddress: "SP_SENDER",
        toBtcAddress: "bc1_dormant",
      }),
    ]);

    const data = await buildActivityData(kv, db);

    const event = data.events.find((e) => e.messageId === "msg_outreach");
    expect(event).toBeDefined();
    expect(event?.agent.displayName).toBe("Tiny Marten");
    expect(event?.recipient?.displayName).toBe("Dormant Agent");
    expect(event?.recipient?.btcAddress).toBe("bc1_dormant");
  });

  it("queries messages once globally rather than fanning out per agent", async () => {
    const agents = Array.from({ length: 30 }, (_, i) =>
      agent({
        stxAddress: `SP_${i}`,
        btcAddress: `bc1_${i}`,
        lastActiveAt: iso(i * 1000),
      })
    );
    getCachedAgentListMock.mockResolvedValue(cacheSnapshot(agents));

    await buildActivityData(kv, db);

    expect(getRecentGlobalInboxEventsFromD1Mock).toHaveBeenCalledTimes(1);
    expect(getRecentGlobalInboxEventsFromD1Mock).toHaveBeenCalledWith(db, 40);
  });

  it("falls back to raw addresses when either side is unregistered", async () => {
    getCachedAgentListMock.mockResolvedValue(cacheSnapshot([]));
    getRecentGlobalInboxEventsFromD1Mock.mockResolvedValue([
      message({
        messageId: "msg_stranger",
        fromAddress: "SP_UNKNOWN",
        toBtcAddress: "bc1_unknown",
      }),
    ]);

    const data = await buildActivityData(kv, db);

    expect(data.events[0].agent.btcAddress).toBe("SP_UNKNOWN");
    expect(data.events[0].agent.displayName).toBe("Unknown Agent");
    expect(data.events[0].recipient?.displayName).toBe("bc1_unknown");
  });

  it("includes registrations from the last 30 days and excludes older ones", async () => {
    const fresh = agent({
      btcAddress: "bc1_fresh",
      displayName: "Fresh Agent",
      verifiedAt: iso(2 * DAY_MS),
    });
    const old = agent({
      btcAddress: "bc1_old",
      displayName: "Old Agent",
      verifiedAt: iso(90 * DAY_MS),
    });
    getCachedAgentListMock.mockResolvedValue(cacheSnapshot([fresh, old]));

    const data = await buildActivityData(kv, db);

    const registrations = data.events.filter((e) => e.type === "registration");
    expect(registrations.map((e) => e.agent.btcAddress)).toEqual(["bc1_fresh"]);
  });

  it("returns events newest-first, capped at 40", async () => {
    getCachedAgentListMock.mockResolvedValue(cacheSnapshot([]));
    getRecentGlobalInboxEventsFromD1Mock.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) =>
        message({ messageId: `msg_${i}`, sentAt: iso(i * 60 * 1000) })
      )
    );

    const data = await buildActivityData(kv, db);

    expect(data.events).toHaveLength(40);
    const timestamps = data.events.map((e) => Date.parse(e.timestamp));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("still returns stats when the D1 read yields nothing (fail-open)", async () => {
    const agents = [
      agent({ btcAddress: "bc1_a", lastActiveAt: iso(DAY_MS), messageCount: 3 }),
      agent({ btcAddress: "bc1_b", lastActiveAt: iso(30 * DAY_MS), messageCount: 1 }),
    ];
    getCachedAgentListMock.mockResolvedValue(cacheSnapshot(agents));

    const data = await buildActivityData(kv, undefined);

    expect(data.stats.totalAgents).toBe(2);
    expect(data.stats.activeAgents).toBe(1);
    expect(data.stats.totalMessages).toBe(4);
    expect(data.stats.totalSatsTransacted).toBe(400);
  });
});
