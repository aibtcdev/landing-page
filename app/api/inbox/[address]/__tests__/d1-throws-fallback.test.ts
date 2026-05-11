/**
 * Phase 2.5 Step 3.1 — D1-throws fallback policy regression test.
 *
 * When the D1 read layer throws (transient unavailability, network error,
 * schema mismatch), the GET handler MUST return 503 with a structured body
 * + Retry-After header rather than letting the runtime surface an
 * unstructured 500. This is the fallback-policy declaration from the
 * Cycle 26 dev-council advisory on PR #722; Steps 3.2/3.3/3.4 will adopt
 * the same shape.
 *
 * See: lib/inbox/d1-reads.ts (helpers under test) and
 * app/api/inbox/[address]/route.ts (try/catch around the Promise.all).
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
  listInboxMessagesFromD1: vi.fn(),
  countInboxMessagesFromD1: vi.fn(),
  fetchRepliesForMessages: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
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
  buildInboxPaymentRequirements: vi.fn(),
  buildSenderAuthMessage: vi.fn(),
  DEFAULT_RELAY_URL: "https://x402-relay.aibtc.com",
  enqueueInboxReconciliation: vi.fn(),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/inbox/payment-logging", () => ({
  getPaymentRepoVersion: vi.fn().mockReturnValue("1.0.0"),
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-dual-write", () => ({
  insertInboundMessageToD1: vi.fn().mockResolvedValue(undefined),
  isPaymentTxidUniqueViolation: (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("UNIQUE constraint failed: inbox_messages.payment_txid");
  },
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  listInboxMessagesFromD1,
  countInboxMessagesFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";

// ---- shared fixtures --------------------------------------------------------

const TEST_ADDR = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const TEST_AGENT = {
  btcAddress: TEST_ADDR,
  stxAddress: "SP3EPDH1E2Y1M4W5GCK4YEJPQ9VW3APJB4Z1QEBNC",
  pubKey: "02deadbeef".padEnd(66, "0"),
  registeredAt: "2026-03-01T00:00:00.000Z",
  level: 2,
};

function buildRequest(): NextRequest {
  return new NextRequest(`https://aibtc.com/api/inbox/${TEST_ADDR}`, {
    method: "GET",
  });
}

function buildContext() {
  return { params: Promise.resolve({ address: TEST_ADDR }) };
}

beforeEach(() => {
  vi.clearAllMocks();

  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: { prepare: vi.fn() } as unknown as D1Database,
      VERIFIED_AGENTS: {} as KVNamespace,
    },
    ctx: { waitUntil: vi.fn() },
  });

  (lookupAgent as Mock).mockResolvedValue(TEST_AGENT);
});

describe("Phase 2.5 Step 3.1 — D1-throws fallback policy", () => {
  it("returns 503 with structured body when listInboxMessagesFromD1 throws", async () => {
    (listInboxMessagesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());

    const res = await GET(buildRequest(), buildContext());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "transient_d1_unavailable",
      retry_after: 5,
    });
    expect(body.message).toMatch(/temporarily unavailable/i);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 with structured body when countInboxMessagesFromD1 throws", async () => {
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: schema mismatch")
    );
    (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());

    const res = await GET(buildRequest(), buildContext());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("does NOT return 500 unhandled when D1 throws — guards the Forge cutover-pattern", async () => {
    (listInboxMessagesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: anything")
    );
    (countInboxMessagesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: anything")
    );
    (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());

    const res = await GET(buildRequest(), buildContext());

    // The implicit-500 case is what Cycle 26 flagged as the persistent
    // 4-cycle gap. Asserting NOT 500 documents the contract structurally.
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(503);
  });
});
