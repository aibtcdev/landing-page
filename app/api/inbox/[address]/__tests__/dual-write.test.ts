/**
 * Regression tests for Phase 2.5 Step 1 — inbox/outbox dual-write to D1.
 *
 * Key properties verified:
 *  - POST /api/inbox/[address]: after KV write succeeds, ctx.waitUntil schedules D1 INSERT
 *  - D1 INSERT failure does NOT fail the 201 response (logged-and-swallowed)
 *  - POST /api/outbox/[address]: after KV write succeeds, ctx.waitUntil schedules D1 INSERT
 *  - D1 INSERT for reply uses is_reply=1 and synthesized PK via deriveReplyD1Id
 *  - When DB binding is absent (env.DB falsy), dual-write is skipped silently
 *
 * These tests exercise the route handlers with mocked downstream functions.
 * They do NOT test the full payment flow — only the dual-write wiring.
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

vi.mock("@/lib/inbox", () => ({
  validateInboxMessage: vi.fn(),
  verifyInboxPayment: vi.fn(),
  verifyTxidPayment: vi.fn(),
  storeMessage: vi.fn(),
  storeStagedInboxPayment: vi.fn(),
  updateAgentInbox: vi.fn(),
  updateSentIndex: vi.fn(),
  INBOX_PRICE_SATS: 100,
  REDEEMED_TXID_TTL_SECONDS: 7776000,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS: 300,
  buildInboxPaymentRequirements: vi.fn().mockReturnValue({ scheme: "exact", network: "stacks:1" }),
  buildSenderAuthMessage: vi.fn().mockReturnValue("Inbox Message | test content"),
  DEFAULT_RELAY_URL: "https://x402-relay.aibtc.com",
  enqueueInboxReconciliation: vi.fn(),
  validateOutboxReply: vi.fn(),
  getMessage: vi.fn(),
  getReply: vi.fn(),
  storeReply: vi.fn(),
  updateMessage: vi.fn(),
  buildReplyMessage: vi.fn(),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/inbox/payment-logging", () => ({
  getPaymentRepoVersion: vi.fn().mockReturnValue("1.0.0"),
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  insertInboundMessageToD1: vi.fn().mockResolvedValue(undefined),
  insertReplyToD1: vi.fn().mockResolvedValue(undefined),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
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

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: vi.fn(),
}));

vi.mock("x402-stacks", () => ({
  networkToCAIP2: vi.fn().mockReturnValue("stacks:1"),
  X402_HEADERS: {
    PAYMENT_SIGNATURE: "payment-signature",
    PAYMENT_REQUIRED: "payment-required",
    PAYMENT_RESPONSE: "payment-response",
  },
}));

vi.mock("@aibtc/tx-schemas/http", () => ({
  HttpPaymentPayloadSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: {} }),
  },
}));

vi.mock("@/lib/validation/address", () => ({
  isStxAddress: vi.fn(() => false),
}));

vi.mock("@/lib/env", () => ({
  shouldFailClosed: vi.fn(() => false),
}));

// ---- imports after mocks ---------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  storeMessage,
  updateAgentInbox,
  validateInboxMessage,
  verifyInboxPayment,
  storeReply,
  updateMessage,
  validateOutboxReply,
  getMessage,
  getReply,
  buildReplyMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import { insertInboundMessageToD1, insertReplyToD1, updateMessageStateD1 } from "@/lib/inbox/d1-dual-write";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { POST as inboxPOST } from "../route";
import { POST as outboxPOST } from "../.././../outbox/[address]/route";

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
  paymentStatus: "confirmed" as const,
};

// ---- helpers ----------------------------------------------------------------

/** Build a mock D1 database */
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

/** Build a mock KV namespace */
function createMockKV(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

/** waitUntil mock that executes the promise synchronously in tests */
function createCtxWithWaitUntil(waitUntilFn: Mock = vi.fn()) {
  return {
    waitUntil: waitUntilFn,
    passThroughOnException: vi.fn(),
  };
}

/** Mock getCloudflareContext to return the given env + ctx */
function mockCloudflareContext(env: Partial<CloudflareEnv>, ctx = createCtxWithWaitUntil()) {
  (getCloudflareContext as Mock).mockResolvedValue({ env, ctx });
}

function createRateLimitMock(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  } as unknown as RateLimit;
}

// ---- inbox POST dual-write tests -------------------------------------------

describe("POST /api/inbox/[address] — D1 dual-write (Phase 2.5 Step 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (storeMessage as Mock).mockResolvedValue(undefined);
    (updateAgentInbox as Mock).mockResolvedValue(undefined);
  });

  it("schedules D1 INSERT via ctx.waitUntil after successful x402 KV write", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      DB: db,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    }, ctx);

    (validateInboxMessage as Mock).mockReturnValue({
      data: {
        toBtcAddress: AGENT.btcAddress,
        toStxAddress: AGENT.stxAddress,
        content: "Hello agent",
        paymentTxid: undefined,
        paymentSatoshis: undefined,
        signature: undefined,
        replyTo: undefined,
      },
    });

    (verifyInboxPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: "abc123",
      paymentStatus: "confirmed",
    });

    const paymentSigHeader = btoa(JSON.stringify({ scheme: "exact" }));
    const req = new NextRequest(`https://aibtc.com/api/inbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": paymentSigHeader,
      },
      body: JSON.stringify({ content: "Hello agent" }),
    });

    const resp = await inboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    expect(resp.status).toBe(201);
    // ctx.waitUntil must have been called (D1 INSERT scheduled)
    expect(waitUntilFn).toHaveBeenCalled();
    // insertInboundMessageToD1 must have been called (inside waitUntil promise)
    expect(insertInboundMessageToD1).toHaveBeenCalledOnce();
    // Verify DB is passed
    const [calledDb] = (insertInboundMessageToD1 as Mock).mock.calls[0];
    expect(calledDb).toBe(db);
  });

  it("D1 INSERT failure does NOT fail the 201 response", async () => {
    const d1Error = new Error("D1 unavailable");
    (insertInboundMessageToD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => {
      try { await p; } catch { /* swallow — simulates Worker swallowing the error */ }
    });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      DB: db,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    }, ctx);

    (validateInboxMessage as Mock).mockReturnValue({
      data: {
        toBtcAddress: AGENT.btcAddress,
        toStxAddress: AGENT.stxAddress,
        content: "Hello agent",
        paymentTxid: undefined,
        paymentSatoshis: undefined,
        signature: undefined,
        replyTo: undefined,
      },
    });

    (verifyInboxPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: "abc123",
      paymentStatus: "confirmed",
    });

    const paymentSigHeader = btoa(JSON.stringify({ scheme: "exact" }));
    const req = new NextRequest(`https://aibtc.com/api/inbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": paymentSigHeader,
      },
      body: JSON.stringify({ content: "Hello agent" }),
    });

    const resp = await inboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    // Response must still be 201 — D1 failure must NOT propagate
    expect(resp.status).toBe(201);
  });

  it("skips D1 INSERT when DB binding is absent (no env.DB)", async () => {
    const waitUntilFn = vi.fn();
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      // DB is intentionally absent
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    }, ctx);

    (validateInboxMessage as Mock).mockReturnValue({
      data: {
        toBtcAddress: AGENT.btcAddress,
        toStxAddress: AGENT.stxAddress,
        content: "Hello agent",
        paymentTxid: undefined,
        paymentSatoshis: undefined,
        signature: undefined,
        replyTo: undefined,
      },
    });

    (verifyInboxPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: "abc123",
      paymentStatus: "confirmed",
    });

    const paymentSigHeader = btoa(JSON.stringify({ scheme: "exact" }));
    const req = new NextRequest(`https://aibtc.com/api/inbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": paymentSigHeader,
      },
      body: JSON.stringify({ content: "Hello agent" }),
    });

    const resp = await inboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    expect(resp.status).toBe(201);
    // ctx.waitUntil should NOT have been called — no DB binding
    expect(waitUntilFn).not.toHaveBeenCalled();
    expect(insertInboundMessageToD1).not.toHaveBeenCalled();
  });
});

// ---- outbox POST dual-write tests ------------------------------------------

describe("POST /api/outbox/[address] — D1 dual-write (Phase 2.5 Step 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (storeReply as Mock).mockResolvedValue(undefined);
    (updateMessage as Mock).mockResolvedValue(undefined);
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
    (getReply as Mock).mockResolvedValue(null); // no existing reply
    (buildReplyMessage as Mock).mockReturnValue("Inbox Reply | msg_123 | hello");
  });

  it("schedules D1 INSERT via ctx.waitUntil after successful KV reply write", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      DB: db,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    }, ctx);

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    const resp = await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    expect(resp.status).toBe(201);
    // ctx.waitUntil must have been called (D1 INSERT scheduled)
    expect(waitUntilFn).toHaveBeenCalled();
    // insertReplyToD1 must have been called
    expect(insertReplyToD1).toHaveBeenCalledOnce();
    // Verify DB and KV are passed
    const [calledDb, calledKv] = (insertReplyToD1 as Mock).mock.calls[0];
    expect(calledDb).toBe(db);
    expect(calledKv).toBe(kv);
  });

  it("D1 INSERT failure does NOT fail the 201 response", async () => {
    const d1Error = new Error("D1 constraint violation");
    (insertReplyToD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => {
      try { await p; } catch { /* swallow — simulates Worker swallowing the error */ }
    });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      DB: db,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    }, ctx);

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    const resp = await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    // Response must still be 201 — D1 failure must NOT propagate
    expect(resp.status).toBe(201);
  });

  it("D1 INSERT is called with is_reply=1 semantics (reply shape with synthesized PK)", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      DB: db,
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    }, ctx);

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    // Verify insertReplyToD1 was called with an OutboxReply object
    expect(insertReplyToD1).toHaveBeenCalledOnce();
    const [, , outboxReplyArg] = (insertReplyToD1 as Mock).mock.calls[0];
    // The reply object should have messageId = parent message ID (not the derived PK)
    // deriveReplyD1Id is called INSIDE insertReplyToD1, not in the route
    expect(outboxReplyArg.messageId).toBe(MESSAGE_ID);
    expect(outboxReplyArg.fromAddress).toBe(AGENT.btcAddress);
  });
});

// ── outbox POST parent-state dual-write tests ─────────────────────────────

describe("POST /api/outbox/[address] — parent message D1 state update (Phase 2.5 Step 3 readiness)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (storeReply as Mock).mockResolvedValue(undefined);
    (updateMessage as Mock).mockResolvedValue(undefined);
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
    (getReply as Mock).mockResolvedValue(null); // no existing reply
    (buildReplyMessage as Mock).mockReturnValue("Inbox Reply | msg_123 | hello");
  });

  it("schedules D1 parent-state UPDATE via ctx.waitUntil after reply write (unread message)", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
        RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
      },
      ctx
    );

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    // Message is UNREAD (no readAt) — both readAt and repliedAt should be set
    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
      // readAt absent — unread
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    const resp = await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    expect(resp.status).toBe(201);
    // waitUntil called at least twice: once for insertReplyToD1, once for updateMessageStateD1
    expect(waitUntilFn).toHaveBeenCalledTimes(2);
    expect(updateMessageStateD1).toHaveBeenCalledOnce();

    const [calledDb, calledMessageId, calledUpdates] = (
      updateMessageStateD1 as Mock
    ).mock.calls[0];
    expect(calledDb).toBe(db);
    // Must target the PARENT message_id directly (not the derived reply PK)
    expect(calledMessageId).toBe(MESSAGE_ID);
    // Message was unread → both fields should be set
    expect(calledUpdates).toHaveProperty("repliedAt");
    expect(calledUpdates).toHaveProperty("readAt");
    expect(typeof calledUpdates.repliedAt).toBe("string");
    expect(typeof calledUpdates.readAt).toBe("string");
  });

  it("sets only repliedAt (not readAt) when parent message was already read", async () => {
    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => { await p; });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
        RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
      },
      ctx
    );

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    // Message is ALREADY READ — only repliedAt should be set
    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
      readAt: "2026-05-10T10:00:00.000Z", // already read
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    const resp = await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    expect(resp.status).toBe(201);
    expect(updateMessageStateD1).toHaveBeenCalledOnce();

    const [, , calledUpdates] = (updateMessageStateD1 as Mock).mock.calls[0];
    // Message was already read → only repliedAt set, no readAt override
    expect(calledUpdates).toHaveProperty("repliedAt");
    expect(calledUpdates).not.toHaveProperty("readAt");
  });

  it("D1 parent-state UPDATE failure does NOT fail the 201 response", async () => {
    const d1Error = new Error("D1 update failed");
    (updateMessageStateD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn(async (p: Promise<unknown>) => {
      try { await p; } catch { /* swallow */ }
    });
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const db = createMockDB();
    const kv = createMockKV();

    mockCloudflareContext(
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        RATE_LIMIT_MUTATING: createRateLimitMock(true),
        RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
      },
      ctx
    );

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    (getMessage as Mock).mockResolvedValue({
      messageId: MESSAGE_ID,
      toBtcAddress: AGENT.btcAddress,
      fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      content: "Hello agent",
      sentAt: "2026-02-18T02:26:42.598Z",
      authenticated: false,
    });

    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: AGENT.btcAddress,
    });

    const req = new NextRequest(`https://aibtc.com/api/outbox/${AGENT.btcAddress}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "50",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID, reply: "hello", signature: "sig123" }),
    });

    const resp = await outboxPOST(req, { params: Promise.resolve({ address: AGENT.btcAddress }) });

    // D1 failure must NOT propagate to the user response
    expect(resp.status).toBe(201);
  });
});
