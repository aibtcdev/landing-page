/**
 * Regression tests for issue #748 — UNIQUE(payment_txid) violations return 409.
 *
 * Two code paths in POST /api/inbox/[address] can hit the UNIQUE partial index
 * `idx_inbox_payment_txid` during concurrent retries:
 *
 *   1. txid-recovery path — SELECT guard + INSERT race produces UNIQUE violation
 *   2. x402 confirmed-delivery path — client retries with same paymentTxid but
 *      server generates a new messageId per attempt; INSERT hits UNIQUE constraint
 *
 * In both cases the route MUST:
 *   - Detect the UNIQUE violation error string from D1
 *   - Re-query via checkRedeemedTxidInD1 to obtain the canonical existingMessageId
 *   - Return HTTP 409 with body { error: "already_redeemed", existingMessageId }
 *   - NOT return 503 (503 is reserved for transient D1 failures, not permanent ones)
 *
 * The "retry storm" contract: 5 parallel INSERTs with same payment_txid must
 * yield 1 × 201 and 4 × 409. This test simulates that by mocking D1 to allow
 * the first insert and reject the subsequent ones with a UNIQUE constraint error.
 *
 * References:
 *   - Issue #748 (this fix)
 *   - PR #745 review threads PRRT_kwDOLbA8Ss6BGIID (txid-recovery) and
 *     PRRT_kwDOLbA8Ss6BGIIY (x402 path)
 *   - Umbrella #652
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
}));

vi.mock("@/lib/inbox/payment-logging", () => ({
  getPaymentRepoVersion: vi.fn().mockReturnValue("1.0.0"),
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  insertInboundMessageToD1: vi.fn(),
  insertReplyToD1: vi.fn(),
  updateMessageStateD1: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  checkRedeemedTxidInD1: vi.fn(),
  listInboxMessagesFromD1: vi.fn().mockResolvedValue([]),
  countInboxMessagesFromD1: vi.fn().mockResolvedValue(0),
  fetchRepliesForMessages: vi.fn().mockResolvedValue(new Map()),
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

// ---- imports after mocks ----------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  validateInboxMessage,
  verifyInboxPayment,
  verifyTxidPayment,
} from "@/lib/inbox";
import { insertInboundMessageToD1 } from "@/lib/inbox/d1-dual-write";
import { checkRedeemedTxidInD1 } from "@/lib/inbox/d1-reads";
import { POST as inboxPOST } from "../route";

// ---- fixtures ---------------------------------------------------------------

const AGENT = {
  btcAddress: "bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76",
  stxAddress: "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K",
  displayName: "Test Agent",
};

const PAYMENT_TXID = "602f097b3de853e05546015af6ac9c32e858efcc9fd5ff92edb860d5cadc8c21";
const EXISTING_MESSAGE_ID = "msg_1771381602504_existing_message_id";

/** The UNIQUE constraint error string that D1/SQLite surfaces. */
const UNIQUE_CONSTRAINT_ERROR = new Error(
  "D1_ERROR: UNIQUE constraint failed: inbox_messages.payment_txid"
);

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

function createRateLimitMock(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  } as unknown as RateLimit;
}

function mockCloudflareContext(env: Partial<CloudflareEnv>) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env,
    ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
  });
}

function buildTxidRecoveryRequest(): NextRequest {
  return new NextRequest(`https://aibtc.com/api/inbox/${AGENT.btcAddress}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "Hello agent",
      paymentTxid: PAYMENT_TXID,
      paymentSatoshis: 100,
    }),
  });
}

function buildX402Request(): NextRequest {
  const paymentSigHeader = btoa(JSON.stringify({ scheme: "exact" }));
  return new NextRequest(`https://aibtc.com/api/inbox/${AGENT.btcAddress}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentSigHeader,
    },
    body: JSON.stringify({ content: "Hello agent" }),
  });
}

function routeParams() {
  return { params: Promise.resolve({ address: AGENT.btcAddress }) };
}

// ---- txid-recovery path tests -----------------------------------------------

describe("POST /api/inbox/[address] — txid-recovery UNIQUE violation → 409 (#748)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);

    // Default: checkRedeemedTxidInD1 finds the existing message
    (checkRedeemedTxidInD1 as Mock).mockResolvedValue(EXISTING_MESSAGE_ID);

    // Default: txid verification succeeds
    (verifyTxidPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: PAYMENT_TXID,
    });

    (validateInboxMessage as Mock).mockReturnValue({
      data: {
        toBtcAddress: AGENT.btcAddress,
        toStxAddress: AGENT.stxAddress,
        content: "Hello agent",
        paymentTxid: PAYMENT_TXID,
        paymentSatoshis: 100,
        signature: undefined,
        replyTo: undefined,
      },
    });
  });

  it("returns 409 with already_redeemed and existingMessageId when INSERT hits UNIQUE(payment_txid)", async () => {
    // Simulate: first SELECT guard passes (no existing record), then INSERT hits UNIQUE violation.
    // This is the txid-recovery race between SELECT and INSERT.
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);

    // The route pre-checks via checkRedeemedTxidInD1 before INSERT —
    // mock that to return null (no existing record at guard time),
    // then the INSERT throws, then the re-check returns the existing ID.
    // We control checkRedeemedTxidInD1 calls: first call (guard) returns null,
    // second call (re-check after violation) returns the existing message ID.
    (checkRedeemedTxidInD1 as Mock)
      .mockResolvedValueOnce(null) // guard check: no existing record
      .mockResolvedValueOnce(EXISTING_MESSAGE_ID); // re-check after violation

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildTxidRecoveryRequest(), routeParams());

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("already_redeemed");
    expect(body.existingMessageId).toBe(EXISTING_MESSAGE_ID);
  });

  it("does NOT return 503 on UNIQUE violation — 503 is reserved for transient errors", async () => {
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);
    (checkRedeemedTxidInD1 as Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(EXISTING_MESSAGE_ID);

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildTxidRecoveryRequest(), routeParams());

    expect(resp.status).not.toBe(503);
    expect(resp.status).toBe(409);
  });

  it("returns 409 with null existingMessageId when re-check also fails", async () => {
    // Edge case: UNIQUE violation fires, but re-check query also fails.
    // Still return 409 (not 503), existingMessageId is null.
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);
    (checkRedeemedTxidInD1 as Mock)
      .mockResolvedValueOnce(null) // guard
      .mockRejectedValueOnce(new Error("D1 transient error")); // re-check fails

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildTxidRecoveryRequest(), routeParams());

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("already_redeemed");
    expect(body.existingMessageId).toBeNull();
  });

  it("returns 503 on non-UNIQUE D1 errors (transient-503 path unchanged)", async () => {
    // A transient D1 error (not a UNIQUE violation) must still return 503.
    (insertInboundMessageToD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset by peer")
    );
    (checkRedeemedTxidInD1 as Mock).mockResolvedValueOnce(null); // guard: no existing record

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildTxidRecoveryRequest(), routeParams());

    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.retryable).toBe(true);
    expect(body.retryAfter).toBe(5);
    expect(resp.headers.get("Retry-After")).toBe("5");
  });
});

// ---- x402 confirmed-delivery path tests -------------------------------------

describe("POST /api/inbox/[address] — x402 delivery UNIQUE violation → 409 (#748)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);

    // Default: checkRedeemedTxidInD1 finds the existing message
    (checkRedeemedTxidInD1 as Mock).mockResolvedValue(EXISTING_MESSAGE_ID);

    // Default: payment verification succeeds with a confirmed payment
    (verifyInboxPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: PAYMENT_TXID,
      paymentStatus: "confirmed",
    });

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
  });

  it("returns 409 with already_redeemed and existingMessageId when x402 INSERT hits UNIQUE(payment_txid)", async () => {
    // x402 client retries with the same paymentTxid; server generates a new messageId
    // per attempt. The INSERT hits the UNIQUE index.
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);
    (checkRedeemedTxidInD1 as Mock).mockResolvedValue(EXISTING_MESSAGE_ID);

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildX402Request(), routeParams());

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("already_redeemed");
    expect(body.existingMessageId).toBe(EXISTING_MESSAGE_ID);
  });

  it("does NOT return 503 on x402 UNIQUE violation", async () => {
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);
    (checkRedeemedTxidInD1 as Mock).mockResolvedValue(EXISTING_MESSAGE_ID);

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildX402Request(), routeParams());

    expect(resp.status).not.toBe(503);
    expect(resp.status).toBe(409);
  });

  it("returns 409 with null existingMessageId when x402 re-check fails", async () => {
    (insertInboundMessageToD1 as Mock).mockRejectedValue(UNIQUE_CONSTRAINT_ERROR);
    (checkRedeemedTxidInD1 as Mock).mockRejectedValue(new Error("D1 transient error"));

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildX402Request(), routeParams());

    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("already_redeemed");
    expect(body.existingMessageId).toBeNull();
  });

  it("returns 503 on non-UNIQUE D1 errors in x402 path (transient-503 path unchanged)", async () => {
    (insertInboundMessageToD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: database is locked")
    );

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const resp = await inboxPOST(buildX402Request(), routeParams());

    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.retryable).toBe(true);
    expect(body.retryAfter).toBe(5);
    expect(resp.headers.get("Retry-After")).toBe("5");
  });
});

// ---- retry-storm simulation -------------------------------------------------

describe("retry-storm simulation — 5 concurrent requests with same payment_txid (#748)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (lookupAgent as Mock).mockResolvedValue(AGENT);

    (verifyTxidPayment as Mock).mockResolvedValue({
      success: true,
      payerStxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      paymentTxid: PAYMENT_TXID,
    });

    (validateInboxMessage as Mock).mockReturnValue({
      data: {
        toBtcAddress: AGENT.btcAddress,
        toStxAddress: AGENT.stxAddress,
        content: "Hello agent",
        paymentTxid: PAYMENT_TXID,
        paymentSatoshis: 100,
        signature: undefined,
        replyTo: undefined,
      },
    });
  });

  it("txid-recovery: 5 parallel requests yield 1×201 + 4×409 with deterministic existingMessageId", async () => {
    // Simulate: first call succeeds, the next 4 hit UNIQUE constraint.
    // checkRedeemedTxidInD1 behavior:
    //   - For the guard check (pre-INSERT): all 5 return null (race condition — no record yet)
    //   - For the re-check (post-violation): returns EXISTING_MESSAGE_ID
    let insertCallCount = 0;
    (insertInboundMessageToD1 as Mock).mockImplementation(async () => {
      insertCallCount++;
      if (insertCallCount === 1) {
        // First insert succeeds
        return undefined;
      }
      // Subsequent inserts hit UNIQUE constraint
      throw UNIQUE_CONSTRAINT_ERROR;
    });

    // checkRedeemedTxidInD1: all guard checks return null, re-checks return the existing ID
    (checkRedeemedTxidInD1 as Mock).mockImplementation(async () => {
      // After the first successful insert, re-checks see the existing record.
      // Guard checks (before INSERT) also see null since we simulate a race.
      // In practice the guard check on the pre-existing 4 requests all pass null
      // because the SELECT runs before any INSERT commits. Post-violation re-checks
      // all return the existing message ID.
      if (insertCallCount > 1) {
        // Post-first-insert: re-checks see the existing record
        return EXISTING_MESSAGE_ID;
      }
      return null;
    });

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    // Fire 5 concurrent requests
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        inboxPOST(buildTxidRecoveryRequest(), routeParams())
      )
    );

    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(4);

    // All 409 responses must have a deterministic existingMessageId
    const conflictResponses = await Promise.all(
      responses
        .filter((r) => r.status === 409)
        .map((r) => r.json())
    );
    for (const body of conflictResponses) {
      expect(body.error).toBe("already_redeemed");
      expect(body.existingMessageId).toBe(EXISTING_MESSAGE_ID);
    }
  });

  it("x402: 5 parallel requests yield 1×201 + 4×409 with deterministic existingMessageId", async () => {
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
      paymentTxid: PAYMENT_TXID,
      paymentStatus: "confirmed",
    });

    let insertCallCount = 0;
    (insertInboundMessageToD1 as Mock).mockImplementation(async () => {
      insertCallCount++;
      if (insertCallCount === 1) {
        return undefined;
      }
      throw UNIQUE_CONSTRAINT_ERROR;
    });

    (checkRedeemedTxidInD1 as Mock).mockResolvedValue(EXISTING_MESSAGE_ID);

    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV(),
      DB: createMockDB(),
      RATE_LIMIT_MUTATING: createRateLimitMock(true),
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        inboxPOST(buildX402Request(), routeParams())
      )
    );

    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(4);

    const conflictBodies = await Promise.all(
      responses
        .filter((r) => r.status === 409)
        .map((r) => r.json())
    );
    for (const body of conflictBodies) {
      expect(body.error).toBe("already_redeemed");
      expect(body.existingMessageId).toBe(EXISTING_MESSAGE_ID);
    }
  });
});
