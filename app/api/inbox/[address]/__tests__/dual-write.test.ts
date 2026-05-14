/**
 * Regression tests for Phase 2.5 Step 4 — D1 as sole source of truth.
 *
 * Updated in Phase 2.5 Step 4 (#730): KV writes removed; D1 is now the
 * authoritative and only write path. Tests updated to match the new contract:
 *
 *  - POST /api/inbox/[address]: D1 INSERT is synchronous (not fire-and-forget).
 *    D1 failure propagates → 503 + Retry-After: 5.
 *    Missing DB binding → 503 + Retry-After: 5.
 *  - POST /api/outbox/[address]: same — D1 INSERT is synchronous.
 *    D1 failure propagates → 503 + Retry-After: 5.
 *    Parent message state update (replied_at / read_at) is still best-effort
 *    via ctx.waitUntil — failure there does NOT fail the 201.
 *
 * These tests exercise the route handlers with mocked downstream functions.
 * They do NOT test the full payment flow — only the D1 write-path wiring.
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
  // P3: insertInboundMessageToD1 and insertReplyToD1 now return D1WriteResult
  insertInboundMessageToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  insertReplyToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
  isPaymentTxidUniqueViolation: (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("UNIQUE constraint failed: inbox_messages.payment_txid");
  },
}));

// P3: inbox/outbox routes now import from @/lib/inbox/stats for count reads
vi.mock("@/lib/inbox/stats", () => ({
  bumpInboundStats: vi.fn().mockResolvedValue(undefined),
  bumpSentStats: vi.fn().mockResolvedValue(undefined),
  getAgentInboxStats: vi.fn().mockResolvedValue({
    receivedCount: 0,
    unreadCount: 0,
    sentCount: 0,
    lastMessageAt: null,
    lastSentAt: null,
  }),
}));

// Phase 2.5 Step 3.5: outbox POST auth reads now use D1 helpers
vi.mock("@/lib/inbox/d1-reads", () => ({
  getInboxMessageFromD1: vi.fn(),
  getReplyForMessageFromD1: vi.fn(),
  listOutboxRepliesFromD1: vi.fn().mockResolvedValue([]),
  countOutboxRepliesFromD1: vi.fn().mockResolvedValue(0),
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
  updateAgentInbox,
  validateInboxMessage,
  verifyInboxPayment,
  storeReply,
  updateMessage,
  validateOutboxReply,
  buildReplyMessage,
  decrementUnreadCount,
} from "@/lib/inbox";
import {
  getInboxMessageFromD1,
  getReplyForMessageFromD1,
} from "@/lib/inbox/d1-reads";
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

// ---- inbox POST D1 sole-source-of-truth tests (Phase 2.5 Step 4) -----------

describe("POST /api/inbox/[address] — D1 sole-source-of-truth (Phase 2.5 Step 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (updateAgentInbox as Mock).mockResolvedValue(undefined);
    // P3: insertInboundMessageToD1 returns D1WriteResult {changes}
    (insertInboundMessageToD1 as Mock).mockResolvedValue({ changes: 1 });
  });

  it("D1 INSERT is synchronous — returns 201 and insertInboundMessageToD1 was called directly", async () => {
    // Step 4 contract: insertInboundMessageToD1 is called synchronously (not
    // fire-and-forget). A successful insert returns 201.
    const waitUntilFn = vi.fn();
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
    // D1 INSERT must have been called (synchronous, not in waitUntil)
    expect(insertInboundMessageToD1).toHaveBeenCalledOnce();
    // Verify DB is passed as first arg
    const [calledDb] = (insertInboundMessageToD1 as Mock).mock.calls[0];
    expect(calledDb).toBe(db);
  });

  it("D1 INSERT failure returns 503 with Retry-After: 5 (Step 4 reversed contract)", async () => {
    // Step 4 contract: D1 failure PROPAGATES — 503 + Retry-After: 5.
    // The old Step-1/2 contract (best-effort, swallow errors) is reversed here.
    const d1Error = new Error("D1 unavailable");
    (insertInboundMessageToD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn();
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

    // D1 failure must propagate — sender retries rather than losing the message
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Retry-After")).toBe("5");
    const body = await resp.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
  });

  it("missing DB binding returns 503 (D1 is required — no fallback)", async () => {
    // Step 4 contract: DB binding is required for delivery. Missing binding → 503.
    // Old Step-1 behavior (skip D1, return 201 anyway) is reversed.
    const waitUntilFn = vi.fn();
    const ctx = createCtxWithWaitUntil(waitUntilFn);
    const kv = createMockKV();

    mockCloudflareContext({
      VERIFIED_AGENTS: kv,
      // DB intentionally absent
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

    // D1 is required — no DB → 503 (not 201 as in the old skip-D1 behavior)
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Retry-After")).toBe("5");
    // D1 insert must NOT have been called — rejected before reaching insert
    expect(insertInboundMessageToD1).not.toHaveBeenCalled();
  });
});

// ---- outbox POST D1 sole-source-of-truth tests (Phase 2.5 Step 4) ----------

describe("POST /api/outbox/[address] — D1 sole-source-of-truth (Phase 2.5 Step 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (storeReply as Mock).mockResolvedValue(undefined);
    (updateMessage as Mock).mockResolvedValue(undefined);
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
    // Phase 2.5 Step 3.5: auth reads now use D1 helpers
    (getInboxMessageFromD1 as Mock).mockResolvedValue(INBOX_MESSAGE); // original message
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(null); // no existing reply
    (buildReplyMessage as Mock).mockReturnValue("Inbox Reply | msg_123 | hello");
    // P3: insertReplyToD1 returns D1WriteResult {changes}
    (insertReplyToD1 as Mock).mockResolvedValue({ changes: 1 });
    (updateMessageStateD1 as Mock).mockResolvedValue(undefined);
  });

  it("D1 INSERT is synchronous — returns 201 and insertReplyToD1 was called directly", async () => {
    // Step 4: insertReplyToD1 is called synchronously; success → 201.
    // ctx.waitUntil is called only for the best-effort parent state update.
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
    // insertReplyToD1 must have been called synchronously
    expect(insertReplyToD1).toHaveBeenCalledOnce();
    // Verify DB and KV are passed
    const [calledDb, calledKv] = (insertReplyToD1 as Mock).mock.calls[0];
    expect(calledDb).toBe(db);
    expect(calledKv).toBe(kv);
  });

  it("D1 INSERT failure returns 503 with Retry-After: 5 (Step 4 reversed contract)", async () => {
    // Step 4 contract: D1 INSERT failure PROPAGATES — 503 + Retry-After: 5.
    // The old best-effort / swallow-errors contract is reversed.
    const d1Error = new Error("D1 constraint violation");
    (insertReplyToD1 as Mock).mockRejectedValue(d1Error);

    const waitUntilFn = vi.fn();
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

    // D1 failure must propagate — replier retries rather than losing the reply
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Retry-After")).toBe("5");
    const body = await resp.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(body.retry_after).toBe(5);
  });

  it("D1 INSERT is called with correct reply shape (messageId = parent message ID)", async () => {
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

// ── outbox POST parent-state D1 tests (still best-effort via ctx.waitUntil) ──

describe("POST /api/outbox/[address] — parent message D1 state update (still best-effort)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);
    (storeReply as Mock).mockResolvedValue(undefined);
    (updateMessage as Mock).mockResolvedValue(undefined);
    (decrementUnreadCount as Mock).mockResolvedValue(undefined);
    // Phase 2.5 Step 3.5: auth reads now use D1 helpers
    (getReplyForMessageFromD1 as Mock).mockResolvedValue(null); // no existing reply
    (buildReplyMessage as Mock).mockReturnValue("Inbox Reply | msg_123 | hello");
    // P3: insertReplyToD1 returns D1WriteResult {changes}
    (insertReplyToD1 as Mock).mockResolvedValue({ changes: 1 });
    (updateMessageStateD1 as Mock).mockResolvedValue(undefined);
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
    (getInboxMessageFromD1 as Mock).mockResolvedValue({
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
    // P3: waitUntil called twice:
    //   1. best-effort parent-state updateMessageStateD1
    //   2. bumpSentStats (changes === 1 from insertReplyToD1)
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
    (getInboxMessageFromD1 as Mock).mockResolvedValue({
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

  it("D1 parent-state UPDATE failure does NOT fail the 201 response (best-effort path)", async () => {
    // The parent-state update (replied_at / read_at on the parent message row)
    // is best-effort via ctx.waitUntil. Its failure must NOT propagate to the
    // caller — the reply row itself is already committed.
    const d1Error = new Error("D1 update failed");
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
        RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
      },
      ctx
    );

    (validateOutboxReply as Mock).mockReturnValue({
      data: { messageId: MESSAGE_ID, reply: "hello", signature: "sig123" },
    });

    (getInboxMessageFromD1 as Mock).mockResolvedValue({
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

    // Parent-state update failure must NOT propagate — reply is already stored
    expect(resp.status).toBe(201);
  });
});
