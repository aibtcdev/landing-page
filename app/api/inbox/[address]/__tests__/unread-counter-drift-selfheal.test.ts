/**
 * Issue #995 — unreadCount counter drift self-heal regression test.
 *
 * The maintained agent_inbox_stats.unread_count can drift above the actual
 * count of unread message rows (the write-path bump/decrement helpers are
 * best-effort, fire-and-forget with swallowed errors). When it does, the GET
 * handler returns phantom unreads that no PATCH can clear because they exist
 * only in the counter, not as message rows.
 *
 * The GET handler self-heals: when the unread view is fetched at offset 0 and
 * the first page is not full, the entire unread set has been enumerated, so the
 * true unread count is exactly the number of returned rows. When the counter
 * disagrees, the handler recomputes this agent's stats and returns the
 * corrected values.
 *
 * See: app/api/inbox/[address]/route.ts (GET self-heal) and
 * lib/inbox/stats.ts (recomputeAgentStats).
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
  listOutboxRepliesFromD1: vi.fn(),
  fetchRepliesForMessages: vi.fn(),
}));

vi.mock("@/lib/inbox/stats", () => ({
  getAgentInboxStats: vi.fn(),
  recomputeAgentStats: vi.fn(),
  bumpInboundStats: vi.fn().mockResolvedValue(undefined),
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
  insertInboundMessageToD1: vi.fn().mockResolvedValue({ changes: 1 }),
  isPaymentTxidUniqueViolation: () => false,
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  listInboxMessagesFromD1,
  listOutboxRepliesFromD1,
  fetchRepliesForMessages,
} from "@/lib/inbox/d1-reads";
import { getAgentInboxStats, recomputeAgentStats } from "@/lib/inbox/stats";

// ---- shared fixtures --------------------------------------------------------

const TEST_ADDR = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const TEST_AGENT = {
  btcAddress: TEST_ADDR,
  stxAddress: "SP3EPDH1E2Y1M4W5GCK4YEJPQ9VW3APJB4Z1QEBNC",
  pubKey: "02deadbeef".padEnd(66, "0"),
  registeredAt: "2026-03-01T00:00:00.000Z",
  level: 2,
};

function buildUnreadRequest(): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/inbox/${TEST_ADDR}?status=unread&limit=10`,
    { method: "GET" }
  );
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
  (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());
  (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
});

describe("Issue #995 — unreadCount drift self-heal", () => {
  it("recomputes and returns the corrected count when the counter drifts above the actual unread rows", async () => {
    // Counter claims 3 unread, but the unread list (offset 0, non-full page) is empty.
    (getAgentInboxStats as Mock).mockResolvedValue({
      receivedCount: 23,
      unreadCount: 3,
      sentCount: 17,
      lastMessageAt: "2026-06-11T17:38:00.000Z",
      lastSentAt: "2026-06-11T17:38:00.000Z",
    });
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]); // no unread rows exist
    (recomputeAgentStats as Mock).mockResolvedValue({
      receivedCount: 23,
      unreadCount: 0,
      sentCount: 17,
      lastMessageAt: "2026-06-11T17:38:00.000Z",
      lastSentAt: "2026-06-11T17:38:00.000Z",
    });

    const res = await GET(buildUnreadRequest(), buildContext());

    expect(res.status).toBe(200);
    expect(recomputeAgentStats).toHaveBeenCalledWith(expect.anything(), TEST_ADDR);
    const body = await res.json();
    expect(body.inbox.unreadCount).toBe(0);
    // status=unread → totalCount tracks the unread predicate
    expect(body.inbox.totalCount).toBe(0);
  });

  it("does NOT recompute when the counter matches the enumerated unread rows", async () => {
    (getAgentInboxStats as Mock).mockResolvedValue({
      receivedCount: 5,
      unreadCount: 2,
      sentCount: 0,
      lastMessageAt: "2026-06-11T17:38:00.000Z",
      lastSentAt: null,
    });
    // Two unread rows returned on a non-full page — matches the counter.
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([
      { messageId: "m1", fromAddress: TEST_AGENT.stxAddress, sentAt: "2026-06-11T10:00:00.000Z" },
      { messageId: "m2", fromAddress: TEST_AGENT.stxAddress, sentAt: "2026-06-11T11:00:00.000Z" },
    ]);

    const res = await GET(buildUnreadRequest(), buildContext());

    expect(res.status).toBe(200);
    expect(recomputeAgentStats).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.inbox.unreadCount).toBe(2);
  });

  it("does NOT recompute on a full page (cannot prove the unread set is fully enumerated)", async () => {
    (getAgentInboxStats as Mock).mockResolvedValue({
      receivedCount: 30,
      unreadCount: 25,
      sentCount: 0,
      lastMessageAt: "2026-06-11T17:38:00.000Z",
      lastSentAt: null,
    });
    // A full page (limit=10) — more unread rows may exist beyond this page.
    (listInboxMessagesFromD1 as Mock).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        messageId: `m${i}`,
        fromAddress: TEST_AGENT.stxAddress,
        sentAt: "2026-06-11T10:00:00.000Z",
      }))
    );

    const res = await GET(buildUnreadRequest(), buildContext());

    expect(res.status).toBe(200);
    expect(recomputeAgentStats).not.toHaveBeenCalled();
  });
});
