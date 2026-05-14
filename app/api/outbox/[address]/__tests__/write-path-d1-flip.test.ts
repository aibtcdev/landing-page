/**
 * Phase 2.5 Step 3.5 — POST /api/outbox/[address] write-path auth read D1 flip.
 *
 * Covers:
 *  4. POST happy path — reply to agent's own inbox message, returns 201, uses D1 reads
 *  5. POST tenant-discriminator on original-message lookup — messageId belongs to
 *       a different agent's inbox → 404 (not a leaked message)
 *  6. POST duplicate-reply guard — second POST to same messageId returns 409,
 *       uses new D1 duplicate-check helper (getReplyForMessageFromD1)
 *  7. POST duplicate-check tenant-discriminator — if a different agent replied to
 *       the same parent (theoretical edge), this agent can still reply (the new
 *       helper's from_btc_address gate prevents false-409)
 *  8. POST D1-throws on each of the three reads → 503 + Retry-After: 5
 *  9. POST partial-write recovery path — verify freshMessage re-read is on D1
 *       and handles null/throw correctly
 *
 * See: https://github.com/aibtcdev/landing-page/issues/736 (Step 3.5 spec)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (must be before route imports) ----------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/inbox", () => ({
  validateOutboxReply: vi.fn(),
  storeReply: vi.fn(),
  updateMessage: vi.fn(),
  buildReplyMessage: vi.fn(() => "Inbox Reply | msg_test | hello"),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  getInboxMessageFromD1: vi.fn(),
  getReplyForMessageFromD1: vi.fn(),
  listOutboxRepliesFromD1: vi.fn().mockResolvedValue([]),
  countOutboxRepliesFromD1: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  // P3: insertReplyToD1 returns D1WriteResult {changes}
  insertReplyToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

// P3: outbox POST now calls bumpSentStats from @/lib/inbox/stats
vi.mock("@/lib/inbox/stats", () => ({
  bumpSentStats: vi.fn().mockResolvedValue(undefined),
  getAgentInboxStats: vi.fn().mockResolvedValue({
    receivedCount: 0,
    unreadCount: 0,
    sentCount: 0,
    lastMessageAt: null,
    lastSentAt: null,
  }),
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

// ---- imports after mocks ---------------------------------------------------

import { POST } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateOutboxReply,
  storeReply,
  updateMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import {
  getInboxMessageFromD1,
  getReplyForMessageFromD1,
} from "@/lib/inbox/d1-reads";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";

// ---- shared fixtures --------------------------------------------------------

const ADDR_A = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h"; // message recipient / replier
const ADDR_B = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn"; // message sender
const MSG_ID = "msg_1778221238475_write_path_d1_test";

const AGENT_A = {
  btcAddress: ADDR_A,
  stxAddress: "SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E",
  displayName: "Frosty Narwhal",
};

// Message addressed to ADDR_A (they can reply)
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

const EXISTING_REPLY = {
  messageId: MSG_ID,
  fromAddress: ADDR_A,
  toBtcAddress: ADDR_B,
  reply: "Thanks for the message!",
  signature: "sig_existing",
  repliedAt: "2026-05-08T07:00:00.000Z",
};

// ---- helpers ----------------------------------------------------------------

function makeMockDB(): D1Database {
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

function buildPostRequest(address: string): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/outbox/${address}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "100",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MSG_ID, reply: "hello", signature: "sig123" }),
    }
  );
}

function buildContext(address: string) {
  return { params: Promise.resolve({ address }) };
}

function createRateLimitMock(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  } as unknown as RateLimit;
}

beforeEach(() => {
  vi.clearAllMocks();

  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: makeMockDB(),
      VERIFIED_AGENTS: {} as KVNamespace,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    },
    ctx: { waitUntil: vi.fn() },
  });

  (lookupAgent as Mock).mockResolvedValue(AGENT_A);
  (validateOutboxReply as Mock).mockReturnValue({
    data: { messageId: MSG_ID, reply: "hello", signature: "sig123" },
  });
  // Default: message exists in D1, no existing reply
  (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
  (getReplyForMessageFromD1 as Mock).mockResolvedValue(null);
  // Default: signature verification passes (ADDR_A signed)
  (verifyBitcoinSignature as Mock).mockReturnValue({
    valid: true,
    address: ADDR_A,
  });

  (storeReply as Mock).mockResolvedValue(undefined);
  (updateMessage as Mock).mockResolvedValue(undefined);
  (decrementUnreadCount as Mock).mockResolvedValue(undefined);
});

// ---- tests ------------------------------------------------------------------

describe("Phase 2.5 Step 3.5 — POST outbox write-path D1 flip", () => {
  it("happy path (test 4): returns 201, uses D1 reads for auth", async () => {
    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/reply sent/i);

    // Verify D1 auth reads were called
    expect(getInboxMessageFromD1).toHaveBeenCalled();
    const [, calledAddress, calledMsgId] = (getInboxMessageFromD1 as Mock).mock.calls[0];
    expect(calledAddress).toBe(ADDR_A); // agent.btcAddress as SQL gate
    expect(calledMsgId).toBe(MSG_ID);

    // Duplicate-check called with replier's BTC address
    expect(getReplyForMessageFromD1).toHaveBeenCalledOnce();
    const [, dupeParentId, dupeFromAddr] = (getReplyForMessageFromD1 as Mock).mock.calls[0];
    expect(dupeParentId).toBe(MSG_ID);
    expect(dupeFromAddr).toBe(ADDR_A); // btcResult.address
  });

  it("tenant-discriminator on original-message lookup (test 5): msgId not in this agent's inbox → 404", async () => {
    // ADDR_A tries to reply to MSG_ID, but the message is not addressed to ADDR_A in D1.
    // SQL gate: WHERE message_id = ? AND to_btc_address = ADDR_A → returns null → 404.
    (getInboxMessageFromD1 as Mock).mockResolvedValue(null);

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Message not found");
    expect(body.messageId).toBe(MSG_ID);
  });

  it("duplicate-reply guard (test 6): existing D1 reply found → 409", async () => {
    // ADDR_A already replied to MSG_ID.
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(EXISTING_REPLY);
    // freshMessage re-read: repliedAt set → true duplicate (all writes completed)
    (getInboxMessageFromD1 as Mock)
      .mockResolvedValueOnce(INBOX_MESSAGE) // first call: original message fetch
      .mockResolvedValueOnce({ ...INBOX_MESSAGE, repliedAt: "2026-05-08T07:00:00.000Z" }); // second: freshMessage

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Reply already exists for this message");
    expect(body.status).toBe("already_delivered");
    expect(body.action).toBe("stop_polling");

    // Verify duplicate-check used D1 helper with correct args
    expect(getReplyForMessageFromD1).toHaveBeenCalledOnce();
    const [, dupeParentId, dupeFromAddr] = (getReplyForMessageFromD1 as Mock).mock.calls[0];
    expect(dupeParentId).toBe(MSG_ID);
    expect(dupeFromAddr).toBe(ADDR_A);
  });

  it("duplicate-check tenant-discriminator (test 7): no prior reply from THIS agent allows reply", async () => {
    // The SQL gate (from_btc_address = ADDR_A) means D1 returns null even if
    // another agent theoretically replied to the same parent. ADDR_A can still reply.
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(null); // no reply from ADDR_A

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    // ADDR_A should be able to reply — no false-409
    expect(res.status).toBe(201);
    // Confirm duplicate check was queried with ADDR_A
    expect(getReplyForMessageFromD1).toHaveBeenCalledOnce();
    const [, , dupeFromAddr] = (getReplyForMessageFromD1 as Mock).mock.calls[0];
    expect(dupeFromAddr).toBe(ADDR_A);
  });

  it("D1-throws on original-message fetch (test 8a): returns 503 + Retry-After: 5", async () => {
    (getInboxMessageFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

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

  it("D1-throws on duplicate-reply check (test 8b): returns 503 + Retry-After: 5", async () => {
    // Original message fetch succeeds, but duplicate-check throws
    (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
    (getReplyForMessageFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: duplicate check failed")
    );

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("D1-throws on partial-write recovery re-read (test 8c): returns 503 + Retry-After: 5", async () => {
    // existingReply found (triggers recovery path), but freshMessage re-read throws
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(EXISTING_REPLY);
    // First call: original message. Second call (freshMessage re-read): throws
    (getInboxMessageFromD1 as Mock)
      .mockResolvedValueOnce(INBOX_MESSAGE)
      .mockRejectedValueOnce(new Error("D1_ERROR: fresh-read failed"));

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("partial-write recovery (test 9): freshMessage re-read is D1; null repliedAt means partial write → completes with 201", async () => {
    // existingReply exists (from same agent), freshMessage.repliedAt is NOT set.
    // Partial write: reply stored but parent message state not updated yet.
    // The handler should complete the write (isRecovery = true) → 201 with recovered: true.
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(EXISTING_REPLY);
    // First call: original message. Second call (freshMessage): repliedAt absent → partial write
    (getInboxMessageFromD1 as Mock)
      .mockResolvedValueOnce(INBOX_MESSAGE)
      .mockResolvedValueOnce({ ...INBOX_MESSAGE, repliedAt: null }); // partial write detected

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    // Partial write detected → complete the operation → 201 with recovered=true
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);

    // Verify both D1 read calls happened (original + freshMessage)
    expect(getInboxMessageFromD1).toHaveBeenCalledTimes(2);
    // Both calls should use the same agent address and message ID
    const [, firstAddr, firstMsg] = (getInboxMessageFromD1 as Mock).mock.calls[0];
    expect(firstAddr).toBe(ADDR_A);
    expect(firstMsg).toBe(MSG_ID);
    const [, secondAddr, secondMsg] = (getInboxMessageFromD1 as Mock).mock.calls[1];
    expect(secondAddr).toBe(ADDR_A);
    expect(secondMsg).toBe(MSG_ID);
  });

  it("DB binding absent → 503 (D1 is now auth gate for POST outbox)", async () => {
    (getCloudflareContext as Mock).mockReturnValue({
      env: {
        // DB intentionally absent
        VERIFIED_AGENTS: {} as KVNamespace,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
        RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
      },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await POST(buildPostRequest(ADDR_A), buildContext(ADDR_A));

    // D1 is required for auth reads — no DB → 503
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});
