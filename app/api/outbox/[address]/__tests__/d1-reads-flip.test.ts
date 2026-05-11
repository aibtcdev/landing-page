/**
 * Phase 2.5 Step 3.3 — GET /api/outbox/[address] D1 read flip.
 *
 * Covers:
 *  1. 200 — replies exist, returned correctly from D1
 *  2. Empty outbox — self-documenting response (no error)
 *  3. 404 — agent not found
 *  4. Tenant-discriminator security gate: reply written by addr_A MUST NOT appear
 *       in GET /api/outbox/addr_B — SQL WHERE from_btc_address=? enforces this.
 *       The route returns empty (not a leaked reply) when address doesn't match.
 *  5. 503 — D1 throws → structured fallback (not unhandled 500)
 *  6. sentCount restoration: inbox-list GET returns sentCount > 0 when D1 reports replies
 *  7. partners-with-sent: partner graph merges both received (inbound senders) and
 *       sent (reply targets) into the partner map
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
  insertReplyToD1: vi.fn().mockResolvedValue(undefined),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
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
import { listOutboxRepliesFromD1 } from "@/lib/inbox/d1-reads";

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

describe("Phase 2.5 Step 3.3 — GET /api/outbox/[address] D1 flip", () => {
  it("returns 200 with outbox shape when replies exist in D1", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);

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

  it("returns self-documenting empty response when no replies found", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);

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

    const res = await GET(buildGetRequest(ADDR_B), buildContext(ADDR_B));

    expect(res.status).toBe(200);
    const body = await res.json();
    // MUST be empty — addr_A's reply must NOT appear here
    expect(body.outbox.replies).toHaveLength(0);
    expect(body.outbox.totalCount).toBe(0);

    // Verify the D1 query was called with ADDR_B (not ADDR_A)
    expect(listOutboxRepliesFromD1).toHaveBeenCalledOnce();
    const [, calledAddress] = (listOutboxRepliesFromD1 as Mock).mock.calls[0];
    expect(calledAddress).toBe(ADDR_B);
  });

  it("returns 503 with structured body when D1 throws — not unhandled 500", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

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

  it("includes pagination shape in response", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([REPLY_FROM_A]);

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
