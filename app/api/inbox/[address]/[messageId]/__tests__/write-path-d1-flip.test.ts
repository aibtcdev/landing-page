/**
 * Phase 2.5 Step 3.5 — PATCH /api/inbox/[address]/[messageId] write-path auth read D1 flip.
 *
 * Covers:
 *  1. PATCH mark-read happy path — agent's own message, returns 200,
 *       calls getInboxMessageFromD1 with correct args
 *  2. PATCH tenant-discriminator — different agent's btcAddress in URL params → 404
 *       (D1 query returns null because SQL gate filters out mismatched address)
 *  3. PATCH D1-throws → 503 + Retry-After: 5 + structured body
 *
 * See: https://github.com/aibtcdev/landing-page/issues/736 (Step 3.5 spec)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (must be before route imports) ----------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/inbox", () => ({
  updateMessage: vi.fn(),
  validateMarkRead: vi.fn(),
  buildMarkReadMessage: vi.fn(() => "Mark as Read | msg_test"),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  getInboxMessageFromD1: vi.fn(),
  fetchRepliesForMessages: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logging", () => ({
  isLogsRPC: vi.fn(() => false),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  shouldFailClosed: vi.fn(() => false),
}));

// ---- imports after mocks ---------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateMarkRead,
  updateMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import { getInboxMessageFromD1 } from "@/lib/inbox/d1-reads";
import { PATCH } from "../route";

// ---- fixtures ---------------------------------------------------------------

const ADDR_A = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const ADDR_B = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";
const MSG_ID = "msg_1778221238475_test_write_path_d1";

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
  // readAt absent — unread
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

function buildPatchRequest(address: string, messageId: string): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/inbox/${address}/${messageId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId, signature: "sig_abc123" }),
    }
  );
}

function buildContext(address: string, messageId: string) {
  return { params: Promise.resolve({ address, messageId }) };
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
    },
    ctx: { waitUntil: vi.fn() },
  });

  (lookupAgent as Mock).mockResolvedValue(AGENT_A);
  (validateMarkRead as Mock).mockReturnValue({
    data: { messageId: MSG_ID, signature: "sig_abc123" },
  });
  (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
  (verifyBitcoinSignature as Mock).mockReturnValue({
    valid: true,
    address: ADDR_A,
  });
  (updateMessage as Mock).mockResolvedValue({ ...INBOX_MESSAGE, readAt: "2026-05-10T12:00:00.000Z" });
  (decrementUnreadCount as Mock).mockResolvedValue(undefined);
});

// ---- tests ------------------------------------------------------------------

describe("Phase 2.5 Step 3.5 — PATCH mark-read write-path D1 flip", () => {
  it("happy path: returns 200, calls getInboxMessageFromD1 with correct args", async () => {
    const res = await PATCH(
      buildPatchRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.messageId).toBe(MSG_ID);
    expect(typeof body.readAt).toBe("string");

    // Verify D1 was called with correct args (agent.btcAddress = ADDR_A, messageId)
    expect(getInboxMessageFromD1).toHaveBeenCalledOnce();
    const [, calledAddress, calledMessageId] = (getInboxMessageFromD1 as Mock).mock.calls[0];
    expect(calledAddress).toBe(ADDR_A);
    expect(calledMessageId).toBe(MSG_ID);
  });

  it("tenant-discriminator: different agent's btcAddress in URL → 404 (SQL gate returns null)", async () => {
    // BLOCK-ON-MERGE: SQL gate in getInboxMessageFromD1 uses AND to_btc_address = ?
    // When ADDR_B is in the URL, D1 returns null because the message belongs to ADDR_A.
    // The route must return 404 (not 403 — avoids leaking existence to non-recipient).
    (lookupAgent as Mock).mockResolvedValue(AGENT_B);
    // D1 returns null — the SQL gate filters out messages not addressed to ADDR_B
    (getInboxMessageFromD1 as Mock).mockResolvedValue(null);

    const res = await PATCH(
      buildPatchRequest(ADDR_B, MSG_ID),
      buildContext(ADDR_B, MSG_ID)
    );

    // MUST be 404, not 403 — avoids leaking existence to non-recipient
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Message not found");
    expect(body.messageId).toBe(MSG_ID);

    // Verify D1 was queried with ADDR_B (not ADDR_A) — the gate is in SQL
    expect(getInboxMessageFromD1).toHaveBeenCalledOnce();
    const [, calledAddress] = (getInboxMessageFromD1 as Mock).mock.calls[0];
    expect(calledAddress).toBe(ADDR_B);
  });

  it("D1-throws → 503 + Retry-After: 5 + structured body", async () => {
    (getInboxMessageFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await PATCH(
      buildPatchRequest(ADDR_A, MSG_ID),
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

  it("DB binding absent → 503 with structured body (D1 is now auth gate)", async () => {
    (getCloudflareContext as Mock).mockReturnValue({
      env: {
        // DB intentionally absent
        VERIFIED_AGENTS: {} as KVNamespace,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
      },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await PATCH(
      buildPatchRequest(ADDR_A, MSG_ID),
      buildContext(ADDR_A, MSG_ID)
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});
