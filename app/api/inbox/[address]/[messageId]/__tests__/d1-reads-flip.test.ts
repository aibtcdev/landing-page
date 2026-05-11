/**
 * Phase 2.5 Step 3.2 — GET /api/inbox/[address]/[messageId] D1 read flip.
 *
 * Covers:
 *  1. 200 — message exists, returned correctly
 *  2. 404 — message not found in D1
 *  3. 404 — address-match guard (block-on-merge per #725 / secret-mars v167):
 *       msg_X has to_btc_address=addr_A; GET .../addr_B/msg_X → 404
 *       (not 200 with body — prevents non-auth disclosure regression)
 *  4. 503 — D1 throws → structured fallback, not unhandled 500
 *  5. Reply attachment — message with reply → response includes .reply object
 *
 * See: https://github.com/aibtcdev/landing-page/issues/725 (Step 3.2 spec)
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
  getInboxMessageFromD1: vi.fn(),
  fetchRepliesForMessages: vi.fn(),
}));

vi.mock("@/lib/inbox", () => ({
  getMessage: vi.fn(),
  updateMessage: vi.fn(),
  validateMarkRead: vi.fn(),
  buildMarkReadMessage: vi.fn(() => "Mark as Read | msg_test"),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/env", () => ({
  shouldFailClosed: vi.fn(() => false),
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  getInboxMessageFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";

// ---- shared fixtures --------------------------------------------------------

const ADDR_A = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const ADDR_B = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";
const MSG_ID = "msg_1778221238475_test_address_match_guard";

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

const INBOX_MESSAGE = {
  messageId: MSG_ID,
  fromAddress: "SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW",
  toBtcAddress: ADDR_A,
  toStxAddress: "SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E",
  content: "Hello from agent B to agent A",
  paymentTxid: "abc123deadbeef",
  paymentSatoshis: 100,
  sentAt: "2026-05-08T06:20:38.665Z",
  authenticated: false,
  paymentStatus: "confirmed" as const,
};

const REPLY = {
  messageId: MSG_ID,
  fromAddress: ADDR_A,
  toBtcAddress: ADDR_B,
  reply: "Thanks for the message!",
  signature: "sig_abc123",
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

function buildGetRequest(address: string, messageId: string): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/inbox/${address}/${messageId}`,
    { method: "GET" }
  );
}

function buildContext(address: string, messageId: string) {
  return { params: Promise.resolve({ address, messageId }) };
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

describe("Phase 2.5 Step 3.2 — GET /api/inbox/[address]/[messageId] D1 flip", () => {
  it("returns 200 with message shape when message exists", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
    (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());

    const res = await GET(
      buildGetRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatchObject({ messageId: MSG_ID, toBtcAddress: ADDR_A });
    expect(body.reply).toBeNull();
    expect(body.recipient).toMatchObject({ btcAddress: ADDR_A });
  });

  it("returns 404 when message_id not found in D1", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (getInboxMessageFromD1 as Mock).mockResolvedValue(null);
    (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());

    const res = await GET(
      buildGetRequest(ADDR_A, "msg_nonexistent"),
      buildContext(ADDR_A, "msg_nonexistent")
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Message not found");
  });

  it("address-match guard: msg_X exists for addr_A but GET with addr_B returns 404 (not 200)", async () => {
    // BLOCK-ON-MERGE per #725 / secret-mars v167. SQL security gate in `getInboxMessageFromD1` (lib/inbox/d1-reads.ts).
    (lookupAgent as Mock).mockResolvedValue(AGENT_B);
    // D1 returns null because ADDR_B does not match ADDR_A in the WHERE clause
    (getInboxMessageFromD1 as Mock).mockResolvedValue(null);

    const res = await GET(
      buildGetRequest(ADDR_B, MSG_ID),
      buildContext(ADDR_B, MSG_ID)
    );

    // MUST be 404, not 200 — a 200 would be a non-auth disclosure
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Message not found");

    // Verify the D1 query was called with ADDR_B (not ADDR_A), confirming
    // the AND clause will never match ADDR_A's message for ADDR_B's query
    expect(getInboxMessageFromD1).toHaveBeenCalledOnce();
    const [, calledAddress, calledMessageId] = (getInboxMessageFromD1 as Mock).mock.calls[0];
    expect(calledAddress).toBe(ADDR_B);
    expect(calledMessageId).toBe(MSG_ID);
  });

  it("returns 503 with structured body when D1 throws — not unhandled 500", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (getInboxMessageFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await GET(
      buildGetRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

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

  it("returns 503 when fetchRepliesForMessages throws after message found", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
    (fetchRepliesForMessages as Mock).mockRejectedValue(
      new Error("D1_ERROR: schema mismatch")
    );

    const res = await GET(
      buildGetRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
  });

  it("reply attachment: message with reply returns .reply object in response", async () => {
    (lookupAgent as Mock).mockResolvedValue(AGENT_A);
    (getInboxMessageFromD1 as Mock).mockResolvedValue({
      ...INBOX_MESSAGE,
      repliedAt: "2026-05-08T07:00:00.000Z",
    });
    const repliesMap = new Map([[MSG_ID, REPLY]]);
    (fetchRepliesForMessages as Mock).mockResolvedValue(repliesMap);

    const res = await GET(
      buildGetRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).not.toBeNull();
    expect(body.reply).toMatchObject({
      messageId: MSG_ID,
      reply: "Thanks for the message!",
    });
  });
});
