/**
 * Phase 2.5 Step 3.3 — GET /api/outbox/[address] D1 read flip.
 *
 * Scope: outbox-route assertions only. The inbox-list sentCount restoration
 * and partners-with-sent coverage live in
 * `app/api/inbox/[address]/__tests__/d1-sentcount-partners.test.ts`.
 *
 * Covers:
 *  1. 200 — replies exist, returned correctly from D1
 *  2. Empty outbox — self-documenting response only when totalCount === 0
 *  3. 404 — agent not found
 *  4. Tenant-discriminator security gate: reply written by addr_A MUST NOT appear
 *       in GET /api/outbox/addr_B — SQL WHERE from_btc_address=? enforces this.
 *       The route returns empty (not a leaked reply) when address doesn't match.
 *  5. 503 — D1 throws → structured fallback (not unhandled 500)
 *  6. Pagination metadata: totalCount comes from COUNT(*), not page length;
 *       hasMore/nextOffset derived from offset + replies.length < totalCount
 *  7. Out-of-range offset returns normal envelope with empty replies, not self-doc
 *  8. NaN guard: non-numeric ?limit / ?offset returns 400, not 503
 *
 * See: https://github.com/aibtcdev/landing-page/issues/728 (Step 3.3 spec)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (must be declared before route imports) -------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  listOutboxRepliesFromD1: vi.fn(),
  countOutboxRepliesFromD1: vi.fn(),
}));

vi.mock("@/lib/inbox", () => ({
  validateOutboxReply: vi.fn(),
  getMessage: vi.fn(),
  getReply: vi.fn(),
  storeReply: vi.fn(),
  updateMessage: vi.fn(),
  buildReplyMessage: vi.fn(() => "Inbox Reply | msg_test | reply"),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  // P3: insertReplyToD1 returns D1WriteResult {changes}
  insertReplyToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

// P3: outbox GET now calls getAgentInboxStats (stats table) instead of
// countOutboxRepliesFromD1 for totalCount.
vi.mock("@/lib/inbox/stats", () => ({
  getAgentInboxStats: vi.fn().mockResolvedValue({
    receivedCount: 0,
    unreadCount: 0,
    sentCount: 1,
    lastMessageAt: null,
    lastSentAt: null,
  }),
  bumpSentStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/env", () => ({
  shouldFailClosed: vi.fn(() => false),
}));

vi.mock("@/lib/validation/address", () => ({
  isStxAddress: vi.fn(() => false),
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { listOutboxRepliesFromD1, countOutboxRepliesFromD1 } from "@/lib/inbox/d1-reads";
import { getAgentInboxStats } from "@/lib/inbox/stats";

// ---- shared fixtures --------------------------------------------------------

const ADDR_A = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const ADDR_B = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";

const AGENT_A = {
  btcAddress: ADDR_A,
  stxAddress: "SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E",
  displayName: "Frosty Narwhal",
};

const AGENT_B = {
  btcAddress: ADDR_B,
  stxAddress: "SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW",
  displayName: "Amber Otter",
};

const REPLY_FROM_A = {
  messageId: "msg_1778221238475_parent",
  fromAddress: ADDR_A,
  toBtcAddress: ADDR_B,
  reply: "Thanks for the message!",
  signature: "sig_abc123base64",
  repliedAt: "2026-05-08T07:00:00.000Z",
};

function makeMockDB() {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    raw: vi.fn(),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

function buildGetRequest(address: string): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/outbox/${address}`,
    { method: "GET" }
  );
}

function buildContext(address: string) {
  return { params: Promise.resolve({ address }) };
}

beforeEach(() => {
  vi.clearAllMocks();

  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: makeMockDB(),
      VERIFIED_AGENTS: {} as KVNamespace,
    },
    ctx: { waitUntil: vi.fn() },
  });
});

// ---- tests ------------------------------------------------------------------

function buildGetRequestWithQuery(address: string, query: string): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/outbox/${address}${query}`,
    { method: "GET" }
  );
}

describe("Phase 2.5 Step 3.3 — GET /api/outbox/[address] D1 flip", () => {
  it("returns 200 with outbox shape when replies exist in D1", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);
    // P3: totalCount now comes from getAgentInboxStats.sentCount (not countOutboxRepliesFromD1)
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 1, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox).toBeDefined();
    expect(body.outbox.replies).toHaveLength(1);
    expect(body.outbox.replies[0]).toMatchObject({
      fromAddress: ADDR_A,
      toBtcAddress: ADDR_B,
      reply: "Thanks for the message!",
    });
    expect(body.outbox.totalCount).toBe(1);
    expect(body.agent.btcAddress).toBe(ADDR_A);
  });

  it("returns self-documenting empty response when totalCount === 0", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
    // P3: totalCount from stats.sentCount = 0
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 0, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.replies).toHaveLength(0);
    expect(body.outbox.totalCount).toBe(0);
    // Self-documenting — includes howToReply
    expect(body.howToReply).toBeDefined();
    expect(body.endpoint).toBe("/api/outbox/[address]");
  });

  it("returns 404 when agent not found", async () => {
    (lookupAgent as Mock).mockResolvedValue(null);

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Agent not found");
  });

  it("tenant-discriminator security gate: GET /api/outbox/addr_B does NOT return addr_A's reply", async () => {
    // BLOCK-ON-MERGE per #728 Step 3.3 spec (analog of #725 address-match guard).
    // The SQL WHERE from_btc_address = ? ensures addr_B's query never matches addr_A's rows.
    // When addr_B has no sent replies, D1 returns empty — not a leaked reply from addr_A.
    (lookupAgent as Mock).mockResolvedValue(AGENT_B);
    // D1 returns empty because ADDR_B has not sent any replies
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
    // P3: totalCount from stats.sentCount = 0 for ADDR_B
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 0, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_B), buildContext(ADDR_B));

    expect(res.status).toBe(200);
    const body = await res.json();
    // MUST be empty — addr_A's reply must NOT appear here
    expect(body.outbox.replies).toHaveLength(0);
    expect(body.outbox.totalCount).toBe(0);

    // Verify listOutboxRepliesFromD1 was called with ADDR_B (not ADDR_A)
    expect(listOutboxRepliesFromD1).toHaveBeenCalledOnce();
    const [, listCalledAddress] = (listOutboxRepliesFromD1 as Mock).mock.calls[0];
    expect(listCalledAddress).toBe(ADDR_B);
    // P3: countOutboxRepliesFromD1 is no longer called; replaced by getAgentInboxStats
    expect(countOutboxRepliesFromD1).not.toHaveBeenCalled();
    expect(getAgentInboxStats).toHaveBeenCalledOnce();
  });

  it("returns 503 with structured body when listOutboxRepliesFromD1 throws — not unhandled 500", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );
    (countOutboxRepliesFromD1 as Mock).mockResolvedValue(1);

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "transient_d1_unavailable",
      retry_after: 5,
    });
    expect(body.message).toMatch(/temporarily unavailable/i);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 when getAgentInboxStats throws (P3: replaces countOutboxRepliesFromD1)", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);
    (getAgentInboxStats as Mock).mockRejectedValue(
      new Error("D1_ERROR: stats query failed")
    );

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
  });

  it("includes pagination shape in response", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 1, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.pagination).toBeDefined();
    expect(body.outbox.pagination).toMatchObject({
      limit: 20,
      offset: 0,
    });
  });
});

describe("Phase 2.5 Step 3.3 — pagination metadata correctness", () => {
  it("totalCount reflects stats.sentCount, not the current page length (P3: replaces COUNT(*) result)", async () => {
    // Agent has 50 lifetime replies but the page returns only 20 (default limit).
    // totalCount must be 50, not 20.
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    const pageReplies = Array.from({ length: 20 }, (_, i) => ({
      ...REPLY_FROM_A,
      messageId: `msg_${i}_parent`,
    }));
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue(pageReplies);
    // P3: totalCount from stats.sentCount
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 50, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.totalCount).toBe(50);
    expect(body.outbox.replies).toHaveLength(20);
    expect(body.outbox.pagination.hasMore).toBe(true);
    expect(body.outbox.pagination.nextOffset).toBe(20);
  });

  it("hasMore is false on the final full page (replies.length === limit but no remaining rows)", async () => {
    // Edge case: page exactly fills (limit=20) but there are no more rows.
    // Pre-fix this reported hasMore: true incorrectly.
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    const pageReplies = Array.from({ length: 20 }, (_, i) => ({
      ...REPLY_FROM_A,
      messageId: `msg_${i}_parent`,
    }));
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue(pageReplies);
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 20, lastMessageAt: null, lastSentAt: null });

    const res = await GET(buildGetRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.pagination.hasMore).toBe(false);
    expect(body.outbox.pagination.nextOffset).toBeNull();
  });

  it("out-of-range offset returns normal envelope with empty replies, not self-doc", async () => {
    // Agent has 5 replies; caller requests offset=100. D1 returns empty page,
    // but totalCount=5 means the agent does have history. Response should be
    // the normal envelope with accurate pagination, NOT the self-doc.
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
    // P3: totalCount from stats.sentCount = 5
    (getAgentInboxStats as Mock).mockResolvedValue({ receivedCount: 0, unreadCount: 0, sentCount: 5, lastMessageAt: null, lastSentAt: null });

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?offset=100"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.replies).toHaveLength(0);
    expect(body.outbox.totalCount).toBe(5);
    expect(body.outbox.pagination.offset).toBe(100);
    expect(body.outbox.pagination.hasMore).toBe(false);
    // Must NOT be the self-doc shape
    expect(body.howToReply).toBeUndefined();
    expect(body.endpoint).toBeUndefined();
  });
});

describe("Phase 2.5 Step 3.3 — query param validation (NaN guard)", () => {
  it("rejects non-numeric ?limit with 400, not 503", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?limit=abc"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(503);
    const body = await res.json();
    expect(body.error).toBe("invalid_query_param");
    // D1 helpers must never be invoked for invalid input
    expect(listOutboxRepliesFromD1).not.toHaveBeenCalled();
    expect(countOutboxRepliesFromD1).not.toHaveBeenCalled();
  });

  it("rejects out-of-range ?limit=0 with 400", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?limit=0"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query_param");
  });

  it("rejects ?limit=101 with 400 (max 100)", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?limit=101"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(400);
  });

  it("rejects negative ?offset with 400", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?offset=-1"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(400);
  });

  it("rejects non-integer ?limit=1.5 with 400", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?limit=1.5"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(400);
  });

  it("accepts ?limit=100 and ?offset=0 (boundary)", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);
    (countOutboxRepliesFromD1 as Mock).mockResolvedValue(1);

    const res = await GET(
      buildGetRequestWithQuery(ADDR_A, "?limit=100&offset=0"),
      buildContext(ADDR_A)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.pagination.limit).toBe(100);
    expect(body.outbox.pagination.offset).toBe(0);
  });
});
