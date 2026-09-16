/**
 * Route-level GET coverage for /api/inbox/[address] (issue #724).
 *
 * The SQL predicates behind each status filter are unit-tested in
 * lib/inbox/__tests__/d1-reads.test.ts. This file tests the handler layer on
 * top of them: which D1 helper each status/view/include combination calls,
 * with which arguments, and how the response envelope (unreadCount,
 * totalCount, receivedCount, sentCount, pagination, partners) is derived from
 * the agent_inbox_stats row rather than from the returned page.
 *
 * Neighbouring files cover the rest of the matrix:
 *  - d1-sentcount-partners.test.ts: include=partners graph (received / sent /
 *    both / dedup), sentCount under include=partners, sent-only envelope
 *  - unread-counter-drift-selfheal.test.ts: status=unread counter self-heal
 *  - d1-throws-fallback.test.ts: 503 when a D1 read throws
 *
 * See: https://github.com/aibtcdev/landing-page/issues/724
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { InboxMessage, InboxPartner } from "@/lib/inbox/types";
import type { AgentInboxStats } from "@/lib/inbox/stats";

// ---- module mocks (must be declared before route imports) -------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  listInboxMessagesFromD1: vi.fn(),
  listSentMessagesFromD1: vi.fn(),
  listOutboxRepliesFromD1: vi.fn(),
  fetchRepliesForMessages: vi.fn(),
}));

vi.mock("@/lib/inbox/stats", () => ({
  getAgentInboxStats: vi.fn(),
  recomputeAgentStats: vi.fn(),
  bumpInboundStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createNoopLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child() { return this; } }),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/inbox", () => ({
  validateInboxMessage: vi.fn(),
  verifyInboxPayment: vi.fn(),
  verifyTxidPayment: vi.fn(),
  storeStagedInboxPayment: vi.fn(),
  INBOX_PRICE_SATS: 100,
  REDEEMED_TXID_TTL_SECONDS: 7776000,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS: 300,
  buildInboxPaymentRequirements: vi.fn(),
  buildSenderAuthMessage: vi.fn(),
  DEFAULT_RELAY_URL: "https://x402-relay.aibtc.com",
  enqueueInboxReconciliation: vi.fn(),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/inbox/payment-logging", () => ({
  getPaymentRepoVersion: vi.fn().mockReturnValue("1.0.0"),
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  insertInboundMessageToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  isPaymentTxidUniqueViolation: () => false,
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  listInboxMessagesFromD1,
  listSentMessagesFromD1,
  listOutboxRepliesFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";
import { getAgentInboxStats, recomputeAgentStats } from "@/lib/inbox/stats";

// ---- response typing ---------------------------------------------------------

type ResponseMessage = InboxMessage & {
  direction: "sent" | "received";
  peerBtcAddress?: string;
  peerDisplayName?: string;
};

interface InboxGetBody {
  endpoint?: string;
  error?: string;
  agent: { btcAddress: string; stxAddress: string; displayName?: string };
  inbox: {
    messages: ResponseMessage[];
    replies: Record<string, unknown>;
    unreadCount: number;
    totalCount: number;
    receivedCount?: number;
    sentCount?: number;
    economics?: { satsReceived: number; satsSent: number; satsNet: number };
    view: "sent" | "received" | "all";
    status: "unread" | "read" | "all";
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
    partners?: InboxPartner[];
  };
  howToSend?: { endpoint: string; price: string };
}

async function readBody(res: Response): Promise<InboxGetBody> {
  return (await res.json()) as InboxGetBody;
}

// ---- shared fixtures --------------------------------------------------------

const AGENT_ADDR = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const AGENT_STX = "SP3EPDH1E2Y1M4W5GCK4YEJPQ9VW3APJB4Z1QEBNC";
const SENDER_ADDR = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";
const SENDER_STX = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
const RECIPIENT_ADDR = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";

const TEST_AGENT = {
  btcAddress: AGENT_ADDR,
  stxAddress: AGENT_STX,
  displayName: "Frosty Narwhal",
};

const SENDER_AGENT = {
  btcAddress: SENDER_ADDR,
  stxAddress: SENDER_STX,
  displayName: "Solar Penguin",
};

const RECIPIENT_AGENT = {
  btcAddress: RECIPIENT_ADDR,
  stxAddress: "SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW",
  displayName: "Amber Otter",
};

function message(id: string, readAt: string | null): InboxMessage {
  return {
    messageId: id,
    fromAddress: SENDER_STX,
    toBtcAddress: AGENT_ADDR,
    toStxAddress: AGENT_STX,
    content: `content of ${id}`,
    paymentSatoshis: 100,
    sentAt: "2026-05-08T06:00:00.000Z",
    readAt,
  };
}

// Known fixture: 3 received messages, 2 unread and 1 read.
const UNREAD_A = message("msg_1778221238475_unread_a", null);
const UNREAD_B = message("msg_1778221238476_unread_b", null);
const READ_C = message("msg_1778221238477_read_c", "2026-05-08T08:00:00.000Z");
const FIXTURE_STATS: AgentInboxStats = {
  receivedCount: 3,
  unreadCount: 2,
  sentCount: 4,
  lastMessageAt: "2026-05-08T06:00:00.000Z",
  lastSentAt: null,
};

function buildGetRequest(query = ""): NextRequest {
  return new NextRequest(`https://aibtc.com/api/inbox/${AGENT_ADDR}${query}`, {
    method: "GET",
  });
}

function buildContext() {
  return { params: Promise.resolve({ address: AGENT_ADDR }) };
}

beforeEach(() => {
  vi.clearAllMocks();

  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: { prepare: vi.fn() } as unknown as D1Database,
      VERIFIED_AGENTS: {} as KVNamespace,
    },
    ctx: { waitUntil: vi.fn() },
  });

  (lookupAgent as Mock).mockImplementation((_kv: unknown, addr: string) => {
    if (addr === AGENT_ADDR) return Promise.resolve(TEST_AGENT);
    if (addr === SENDER_STX || addr === SENDER_ADDR) return Promise.resolve(SENDER_AGENT);
    if (addr === RECIPIENT_ADDR) return Promise.resolve(RECIPIENT_AGENT);
    return Promise.resolve(null);
  });
  (getAgentInboxStats as Mock).mockResolvedValue(FIXTURE_STATS);
  (listInboxMessagesFromD1 as Mock).mockImplementation(
    (_db: unknown, _addr: string, _limit: number, _offset: number, status: string) => {
      if (status === "unread") return Promise.resolve([UNREAD_A, UNREAD_B]);
      if (status === "read") return Promise.resolve([READ_C]);
      return Promise.resolve([UNREAD_A, UNREAD_B, READ_C]);
    }
  );
  (listSentMessagesFromD1 as Mock).mockResolvedValue([]);
  (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
  (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());
});

// ---- status filter ----------------------------------------------------------

describe("GET /api/inbox/[address] status filter (view=received)", () => {
  it("status=read passes 'read' to the D1 helper and returns only read messages", async () => {
    const res = await GET(buildGetRequest("?view=received&status=read"), buildContext());

    expect(res.status).toBe(200);
    expect(listInboxMessagesFromD1).toHaveBeenCalledWith(
      expect.anything(), AGENT_ADDR, 20, 0, "read"
    );
    const body = await readBody(res);
    expect(body.inbox.status).toBe("read");
    expect(body.inbox.messages.map((m) => m.messageId)).toEqual([READ_C.messageId]);
    expect(body.inbox.messages.every((m) => m.readAt != null)).toBe(true);
    // totalCount for 'read' = receivedCount - unreadCount from stats
    expect(body.inbox.totalCount).toBe(1);
    // unreadCount is the agent-wide counter, not the page's unread count (0)
    expect(body.inbox.unreadCount).toBe(2);
  });

  it("status=unread passes 'unread' and returns only unread messages with the stats unreadCount", async () => {
    const res = await GET(buildGetRequest("?view=received&status=unread"), buildContext());

    expect(res.status).toBe(200);
    expect(listInboxMessagesFromD1).toHaveBeenCalledWith(
      expect.anything(), AGENT_ADDR, 20, 0, "unread"
    );
    const body = await readBody(res);
    expect(body.inbox.status).toBe("unread");
    expect(body.inbox.messages.map((m) => m.messageId)).toEqual([
      UNREAD_A.messageId,
      UNREAD_B.messageId,
    ]);
    expect(body.inbox.messages.every((m) => m.readAt == null)).toBe(true);
    expect(body.inbox.unreadCount).toBe(2);
    expect(body.inbox.totalCount).toBe(2);
    // Counter agrees with the enumerated page, so no self-heal recompute
    expect(recomputeAgentStats).not.toHaveBeenCalled();
  });

  it("status=all returns read and unread messages with totalCount = receivedCount", async () => {
    const res = await GET(buildGetRequest("?view=received&status=all"), buildContext());

    expect(res.status).toBe(200);
    expect(listInboxMessagesFromD1).toHaveBeenCalledWith(
      expect.anything(), AGENT_ADDR, 20, 0, "all"
    );
    const body = await readBody(res);
    expect(body.inbox.status).toBe("all");
    expect(body.inbox.messages).toHaveLength(3);
    expect(body.inbox.totalCount).toBe(3);
    expect(body.inbox.receivedCount).toBe(3);
    expect(body.inbox.unreadCount).toBe(2);
  });

  it("defaults to view=all and status=all when no params are given (same D1 read as view=received)", async () => {
    const res = await GET(buildGetRequest(), buildContext());

    expect(res.status).toBe(200);
    expect(listInboxMessagesFromD1).toHaveBeenCalledWith(
      expect.anything(), AGENT_ADDR, 20, 0, "all"
    );
    expect(listSentMessagesFromD1).not.toHaveBeenCalled();
    const body = await readBody(res);
    expect(body.inbox.view).toBe("all");
    expect(body.inbox.status).toBe("all");
    expect(body.inbox.messages).toHaveLength(3);
    expect(body.inbox.messages.every((m) => m.direction === "received")).toBe(true);
  });
});

// ---- envelope shape -----------------------------------------------------------

describe("GET /api/inbox/[address] view=received envelope", () => {
  it("returns the full envelope with resolved peers, stats-derived counts and economics", async () => {
    const replyForA = {
      messageId: UNREAD_A.messageId,
      fromAddress: AGENT_ADDR,
      toBtcAddress: SENDER_ADDR,
      reply: "thanks",
      signature: "sig",
      repliedAt: "2026-05-08T09:00:00.000Z",
    };
    (fetchRepliesForMessages as Mock).mockResolvedValue(
      new Map([[UNREAD_A.messageId, replyForA]])
    );

    const res = await GET(buildGetRequest("?view=received"), buildContext());

    expect(res.status).toBe(200);
    const body = await readBody(res);

    expect(body.endpoint).toBeUndefined(); // not the empty-inbox self-doc
    expect(body.agent).toEqual({
      btcAddress: AGENT_ADDR,
      stxAddress: AGENT_STX,
      displayName: "Frosty Narwhal",
    });
    expect(body.inbox.view).toBe("received");
    expect(body.inbox.status).toBe("all");

    const first = body.inbox.messages[0];
    expect(first.direction).toBe("received");
    expect(first.peerBtcAddress).toBe(SENDER_ADDR);
    expect(first.peerDisplayName).toBe("Solar Penguin");

    // Inline replies are fetched for exactly the visible page
    expect(fetchRepliesForMessages).toHaveBeenCalledWith(expect.anything(), [
      UNREAD_A.messageId,
      UNREAD_B.messageId,
      READ_C.messageId,
    ]);
    expect(body.inbox.replies).toEqual({ [UNREAD_A.messageId]: replyForA });

    // Without include=partners: sentCount comes from stats, outbox not read
    expect(listOutboxRepliesFromD1).not.toHaveBeenCalled();
    expect(body.inbox.sentCount).toBe(4);
    expect(body.inbox.economics).toEqual({
      satsReceived: 300,
      satsSent: 400,
      satsNet: -100,
    });
    expect(body.inbox.partners).toBeUndefined();
    expect(body.howToSend?.endpoint).toBe(`POST /api/inbox/${AGENT_ADDR}`);
  });

  it("returns the self-doc envelope (with partners: [] when requested) for an agent with no activity", async () => {
    (getAgentInboxStats as Mock).mockResolvedValue({
      ...FIXTURE_STATS,
      receivedCount: 0,
      unreadCount: 0,
      sentCount: 0,
    });
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);

    const res = await GET(
      buildGetRequest("?view=received&status=read&include=partners"),
      buildContext()
    );

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.endpoint).toBe("/api/inbox/[address]");
    expect(body.inbox.messages).toEqual([]);
    expect(body.inbox.view).toBe("received");
    expect(body.inbox.status).toBe("read");
    expect(body.inbox.partners).toEqual([]);
    expect(body.inbox.pagination).toEqual({
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
  });
});

// ---- pagination ---------------------------------------------------------------

describe("GET /api/inbox/[address] pagination", () => {
  it("propagates limit/offset to the D1 helper and derives hasMore from the stats total", async () => {
    (getAgentInboxStats as Mock).mockResolvedValue({
      ...FIXTURE_STATS,
      receivedCount: 25,
      unreadCount: 12,
    });
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([UNREAD_A, UNREAD_B]);

    const res = await GET(
      buildGetRequest("?view=received&status=unread&limit=2&offset=4"),
      buildContext()
    );

    expect(res.status).toBe(200);
    expect(listInboxMessagesFromD1).toHaveBeenCalledWith(
      expect.anything(), AGENT_ADDR, 2, 4, "unread"
    );
    const body = await readBody(res);
    expect(body.inbox.totalCount).toBe(12);
    expect(body.inbox.pagination).toEqual({
      limit: 2,
      offset: 4,
      hasMore: true,
      nextOffset: 6,
    });
    // offset > 0: self-heal must not fire even though the page is short of the counter
    expect(recomputeAgentStats).not.toHaveBeenCalled();
  });

  it("reports hasMore=false and nextOffset=null on the last page", async () => {
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([READ_C]);

    const res = await GET(buildGetRequest("?status=all&limit=2&offset=2"), buildContext());

    const body = await readBody(res);
    expect(body.inbox.totalCount).toBe(3);
    expect(body.inbox.pagination).toEqual({
      limit: 2,
      offset: 2,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("clamps limit to [1, 100] and offset to >= 0 before calling D1", async () => {
    await GET(buildGetRequest("?limit=500&offset=-7"), buildContext());
    expect(listInboxMessagesFromD1).toHaveBeenLastCalledWith(
      expect.anything(), AGENT_ADDR, 100, 0, "all"
    );

    await GET(buildGetRequest("?limit=0"), buildContext());
    expect(listInboxMessagesFromD1).toHaveBeenLastCalledWith(
      expect.anything(), AGENT_ADDR, 1, 0, "all"
    );
  });
});

// ---- include=partners ---------------------------------------------------------

describe("GET /api/inbox/[address] include=partners shape", () => {
  it("returns partners with the documented fields and reads outbox replies (limit 100, offset 0)", async () => {
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([
      {
        messageId: UNREAD_A.messageId,
        fromAddress: AGENT_ADDR,
        toBtcAddress: RECIPIENT_ADDR,
        reply: "hi",
        signature: "sig",
        repliedAt: "2026-05-08T10:00:00.000Z",
      },
    ]);

    const res = await GET(
      buildGetRequest("?view=received&status=unread&include=partners"),
      buildContext()
    );

    expect(res.status).toBe(200);
    expect(listOutboxRepliesFromD1).toHaveBeenCalledWith(expect.anything(), AGENT_ADDR, 100, 0);
    const body = await readBody(res);
    const partners = body.inbox.partners;
    expect(partners).toBeDefined();
    // Sorted by messageCount desc: sender (2 unread received) before recipient (1 sent)
    expect(partners).toEqual([
      {
        btcAddress: SENDER_ADDR,
        stxAddress: SENDER_STX,
        displayName: "Solar Penguin",
        messageCount: 2,
        lastInteractionAt: "2026-05-08T06:00:00.000Z",
        direction: "received",
      },
      {
        btcAddress: RECIPIENT_ADDR,
        stxAddress: RECIPIENT_AGENT.stxAddress,
        displayName: "Amber Otter",
        messageCount: 1,
        lastInteractionAt: "2026-05-08T10:00:00.000Z",
        direction: "sent",
      },
    ]);
    // Under include=partners sentCount is the fetched outbox length, not stats.sentCount
    expect(body.inbox.sentCount).toBe(1);
  });

  it("partners are built from the returned page only, so status=read shows only read-message senders", async () => {
    const otherSenderRead = { ...READ_C, fromAddress: RECIPIENT_AGENT.stxAddress };
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([otherSenderRead]);
    (lookupAgent as Mock).mockImplementation((_kv: unknown, addr: string) => {
      if (addr === AGENT_ADDR) return Promise.resolve(TEST_AGENT);
      if (addr === RECIPIENT_AGENT.stxAddress) return Promise.resolve(RECIPIENT_AGENT);
      return Promise.resolve(null);
    });

    const res = await GET(buildGetRequest("?status=read&include=partners"), buildContext());

    const body = await readBody(res);
    expect(body.inbox.partners?.map((p) => p.btcAddress)).toEqual([RECIPIENT_ADDR]);
  });
});

// ---- view=sent ------------------------------------------------------------------

describe("GET /api/inbox/[address] view=sent", () => {
  it("reads originated messages by STX address with limit/offset and a page-derived hasMore", async () => {
    const sentA: InboxMessage = {
      ...message("msg_1778221238480_sent_a", null),
      fromAddress: AGENT_STX,
      toBtcAddress: RECIPIENT_ADDR,
      toStxAddress: RECIPIENT_AGENT.stxAddress,
    };
    const sentB: InboxMessage = { ...sentA, messageId: "msg_1778221238481_sent_b", toBtcAddress: "bc1qunknownrecipient" };
    (listSentMessagesFromD1 as Mock).mockResolvedValue([sentA, sentB]);

    const res = await GET(buildGetRequest("?view=sent&limit=2&offset=6"), buildContext());

    expect(res.status).toBe(200);
    expect(listSentMessagesFromD1).toHaveBeenCalledWith(expect.anything(), AGENT_STX, 2, 6);
    // The received path and the stats row are not touched
    expect(listInboxMessagesFromD1).not.toHaveBeenCalled();
    expect(getAgentInboxStats).not.toHaveBeenCalled();

    const body = await readBody(res);
    expect(body.inbox.view).toBe("sent");
    expect(body.inbox.unreadCount).toBe(0);
    expect(body.inbox.totalCount).toBe(8); // lower bound: offset + page length
    expect(body.inbox.pagination).toEqual({ limit: 2, offset: 6, hasMore: true, nextOffset: 8 });
    expect(body.inbox.messages.map((m) => [m.direction, m.peerBtcAddress, m.peerDisplayName])).toEqual([
      ["sent", RECIPIENT_ADDR, "Amber Otter"],
      ["sent", "bc1qunknownrecipient", undefined],
    ]);
  });

  it("echoes status and ignores include=partners (no filter, no partners, no counts)", async () => {
    (listSentMessagesFromD1 as Mock).mockResolvedValue([]);

    const res = await GET(
      buildGetRequest("?view=sent&status=unread&include=partners"),
      buildContext()
    );

    expect(res.status).toBe(200);
    expect(listOutboxRepliesFromD1).not.toHaveBeenCalled();
    const body = await readBody(res);
    expect(body.inbox.status).toBe("unread");
    expect(body.inbox.messages).toEqual([]);
    expect(body.inbox.partners).toBeUndefined();
    expect(body.inbox.sentCount).toBeUndefined();
    expect(body.inbox.pagination).toEqual({ limit: 20, offset: 0, hasMore: false, nextOffset: null });
  });

  it("returns an empty page without querying D1 when the agent has no STX address", async () => {
    (lookupAgent as Mock).mockResolvedValue({ ...TEST_AGENT, stxAddress: undefined });

    const res = await GET(buildGetRequest("?view=sent&status=read"), buildContext());

    expect(res.status).toBe(200);
    expect(listSentMessagesFromD1).not.toHaveBeenCalled();
    const body = await readBody(res);
    expect(body.inbox.messages).toEqual([]);
    expect(body.inbox.totalCount).toBe(0);
  });
});

// ---- validation -----------------------------------------------------------------

describe("GET /api/inbox/[address] validation", () => {
  it("rejects an unknown view with 400", async () => {
    const res = await GET(buildGetRequest("?view=outbox"), buildContext());
    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toMatch(/Invalid view parameter/);
    expect(getAgentInboxStats).not.toHaveBeenCalled();
  });

  it("rejects an unknown status with 400", async () => {
    const res = await GET(buildGetRequest("?status=archived"), buildContext());
    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toMatch(/Invalid status parameter/);
    expect(listInboxMessagesFromD1).not.toHaveBeenCalled();
  });

  it("returns 404 when the agent is not registered", async () => {
    (lookupAgent as Mock).mockResolvedValue(null);
    const res = await GET(buildGetRequest(), buildContext());
    expect(res.status).toBe(404);
    expect((await readBody(res)).error).toBe("Agent not found");
  });
});

// ---- structural witness (issue #724 acceptance) -----------------------------------

describe("GET /api/inbox/[address] unreadCount witness", () => {
  it.each([
    ["all", 3],
    ["unread", 2],
    ["read", 1],
  ] as const)(
    "status=%s: unreadCount equals the stats row (2) and totalCount is %i for the 3-message fixture",
    async (status, expectedTotal) => {
      const res = await GET(buildGetRequest(`?view=received&status=${status}`), buildContext());

      expect(getAgentInboxStats).toHaveBeenCalledWith(expect.anything(), AGENT_ADDR);
      const body = await readBody(res);
      expect(body.inbox.unreadCount).toBe(FIXTURE_STATS.unreadCount);
      expect(body.inbox.receivedCount).toBe(FIXTURE_STATS.receivedCount);
      expect(body.inbox.totalCount).toBe(expectedTotal);
      // Must match the fixture's own count of unread rows
      expect(body.inbox.unreadCount).toBe(
        [UNREAD_A, UNREAD_B, READ_C].filter((m) => m.readAt == null).length
      );
    }
  );
});
