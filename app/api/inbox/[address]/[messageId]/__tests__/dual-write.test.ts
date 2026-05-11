/**
 * Tests for the mark-read PATCH D1 sole-source-of-truth (Phase 2.5 Step 4).
 *
 * Updated in Phase 2.5 Step 4 (#730): KV writes (updateMessage,
 * decrementUnreadCount) are removed; D1 is now the sole write path.
 * The D1 UPDATE is synchronous and failure-propagating.
 *
 * Previously (Steps 1-3): D1 UPDATE was scheduled via ctx.waitUntil (best-effort)
 * and failure did NOT fail the 200 response. That contract is REVERSED in Step 4.
 *
 * Verifies (Step 4 contract):
 *  - After D1 auth read succeeds, updateMessageStateD1 is called synchronously
 *  - D1 UPDATE success → 200 response with readAt
 *  - D1 UPDATE failure → 503 + Retry-After: 5 (failure propagates)
 *  - When DB binding is absent → 503 (D1 is required auth gate, not a fallback)
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
  getAgentInbox: vi.fn(),
  validateMarkRead: vi.fn(),
  buildMarkReadMessage: vi.fn(() => "Mark as Read | msg_123"),
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

describe("PATCH /api/inbox/[address]/[messageId] — D1 sole-source-of-truth (Phase 2.5 Step 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (validateMarkRead as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, signature: "sig_abc123" },
    });
    // Phase 2.5 Step 3.5: auth read is now D1, not KV
    (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE);
    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });
    (updateMessage as Mock).mockResolvedValue({ ...INBOX_MESSAGE, readAt: "2026-05-10T12:00:00.000Z" });
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
    // Re-apply resolved values cleared by clearAllMocks
    (updateMessageStateD1 as Mock).mockResolvedValue(undefined);
  });

  it("D1 UPDATE is synchronous — returns 200 and updateMessageStateD1 was called directly", async () => {
    // Step 4 contract: updateMessageStateD1 is called synchronously (not via
    // ctx.waitUntil). Success → 200 with readAt in the response.
    const waitUntilFn = vi.fn();
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
    // D1 UPDATE must have been called synchronously
    expect(updateMessageStateD1).toHaveBeenCalledOnce();
    // ctx.waitUntil must NOT have been called — D1 UPDATE is no longer fire-and-forget
    expect(waitUntilFn).not.toHaveBeenCalled();

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

  it("D1 UPDATE failure returns 503 with Retry-After: 5 (Step 4 reversed contract)", async () => {
    // Step 4 contract: D1 UPDATE failure PROPAGATES — 503 + Retry-After: 5.
    // The old Step-1/2 contract ("D1 UPDATE failure does NOT fail the 200 response")
    // is REVERSED: D1 is now the sole write path, so failure must propagate.
    const d1Error = new Error("D1 constraint violation");
    (updateMessageStateD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn();
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

    // D1 failure must propagate — caller retries rather than getting a phantom 200
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Retry-After")).toBe("5");
    const body = await resp.json();
    expect(body.retryable).toBe(true);
    expect(body.retryAfter).toBe(5);
  });

  it("returns 503 when DB binding is absent (D1 is now the auth gate, not a fallback)", async () => {
    // Phase 2.5 Step 3.5: D1 is now the auth read source for PATCH.
    // When env.DB is absent, the handler returns 503 (not 200) because
    // it cannot perform the auth read without D1.
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

    // D1 is now required for auth read — no DB → 503 transient unavailable
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
    expect(resp.headers.get("Retry-After")).toBe("5");
    // ctx.waitUntil should NOT have been called — request rejected early
    expect(waitUntilFn).not.toHaveBeenCalled();
    expect(updateMessageStateD1).not.toHaveBeenCalled();
  });
});
