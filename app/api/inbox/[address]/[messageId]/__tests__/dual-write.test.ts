/**
 * Tests for the mark-read PATCH D1 dual-write (Phase 2.5 Step 3 readiness).
 *
 * Verifies:
 *  - After successful KV mark-read, ctx.waitUntil schedules D1 UPDATE
 *  - D1 UPDATE is called with the correct messageId and { readAt: now }
 *  - D1 UPDATE failure is swallowed — response is still 200
 *  - When DB binding is absent, dual-write is skipped silently
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
  getMessage: vi.fn(),
  getReply: vi.fn(),
  updateMessage: vi.fn(),
  getAgentInbox: vi.fn(),
  validateMarkRead: vi.fn(),
  buildMarkReadMessage: vi.fn(() => "Mark as Read | msg_123"),
  decrementUnreadCount: vi.fn(),
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
  getMessage,
  validateMarkRead,
  updateMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import { updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";
import { PATCH } from "../route";

// ---- fixtures ---------------------------------------------------------------

const AGENT = {
  btcAddress: "bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76",
  stxAddress: "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K",
  displayName: "Test Agent",
};

const MESSAGE_ID = "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf";

const INBOX_MESSAGE = {
  messageId: MESSAGE_ID,
  fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
  toBtcAddress: AGENT.btcAddress,
  toStxAddress: AGENT.stxAddress,
  content: "Hello agent",
  paymentTxid: "abc123",
  paymentSatoshis: 100,
  sentAt: "2026-02-18T02:26:42.598Z",
  authenticated: false,
  // readAt intentionally absent — message is unread
};

// ---- helpers ----------------------------------------------------------------

function createMockDB(): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    first: vi.fn(),
    all: vi.fn(),
    raw: vi.fn(),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

function createMockKV(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function createCtxWithWaitUntil(waitUntilFn: Mock = vi.fn()) {
  return {
    waitUntil: waitUntilFn,
    passThroughOnException: vi.fn(),
  };
}

function mockCloudflareContext(
  env: Partial<CloudflareEnv>,
  ctx = createCtxWithWaitUntil()
) {
  (getCloudflareContext as Mock).mockResolvedValue({ env, ctx });
}

function createRateLimitMock(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  } as unknown as RateLimit;
}

function buildPatchRequest(address: string, messageId: string) {
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

// ---- tests ------------------------------------------------------------------

describe("PATCH /api/inbox/[address]/[messageId] — D1 dual-write (Phase 2.5 Step 3 readiness)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (validateMarkRead as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, signature: "sig_abc123" },
    });
    (getMessage as Mock).mockResolvedValue(INBOX_MESSAGE);
    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });
    (updateMessage as Mock).mockResolvedValue({ ...INBOX_MESSAGE, readAt: "2026-05-10T12:00:00.000Z" });
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
  });

  it("schedules D1 UPDATE via ctx.waitUntil after successful KV mark-read", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
      },
      ctx
    );

    const req = buildPatchRequest(AGENT.btcAddress, MESSAGE_ID);
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: AGENT.btcAddress, messageId: MESSAGE_ID }),
    });

    expect(resp.status).toBe(200);
    expect(waitUntilFn).toHaveBeenCalled();
    expect(updateMessageStateD1).toHaveBeenCalledOnce();

    // Verify called with correct messageId and readAt field
    const [calledDb, calledMessageId, calledUpdates] = (
      updateMessageStateD1 as Mock
    ).mock.calls[0];
    expect(calledDb).toBe(db);
    expect(calledMessageId).toBe(MESSAGE_ID);
    expect(calledUpdates).toHaveProperty("readAt");
    expect(typeof calledUpdates.readAt).toBe("string");
    expect(calledUpdates).not.toHaveProperty("repliedAt");
  });

  it("D1 UPDATE failure does NOT fail the 200 response", async () => {
    const d1Error = new Error("D1 constraint violation");
    (updateMessageStateD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => {
      try { await p; } catch { /* swallow — simulates Worker swallowing the error */ }
    });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
      },
      ctx
    );

    const req = buildPatchRequest(AGENT.btcAddress, MESSAGE_ID);
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: AGENT.btcAddress, messageId: MESSAGE_ID }),
    });

    // Response must still be 200 — D1 failure must NOT propagate
    expect(resp.status).toBe(200);
  });

  it("skips D1 UPDATE when DB binding is absent", async () => {
    const waitUntilFn = vi.fn();
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        // DB intentionally absent
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
      },
      ctx
    );

    const req = buildPatchRequest(AGENT.btcAddress, MESSAGE_ID);
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: AGENT.btcAddress, messageId: MESSAGE_ID }),
    });

    expect(resp.status).toBe(200);
    expect(waitUntilFn).not.toHaveBeenCalled();
    expect(updateMessageStateD1).not.toHaveBeenCalled();
  });
});
