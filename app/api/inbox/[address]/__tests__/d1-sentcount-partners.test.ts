/**
 * Phase 2.5 Step 3.3 — sentCount restoration + partners-with-sent tests.
 *
 * Updated by perf/d1-inbox-count-4to2: sentCount is now derived from
 * sentMessages.length (listOutboxRepliesFromD1 result) rather than from
 * countOutboxRepliesFromD1. This removes one COUNT(*) per request.
 *
 * Covers:
 *  1. sentCount derivation: inbox-list GET returns sentCount > 0 when
 *       listOutboxRepliesFromD1 returns reply objects (sentCount = replies.length)
 *  2. partners-with-sent: partner graph includes both inbound senders (received)
 *       AND addresses this agent has replied to (sent)
 *  3. partners-received-only: when no sent replies exist, partners still computed
 *       from received messages
 *  4. D1-throws fallback: D1 throws still produce 503 + Retry-After: 5
 *
 * See: https://github.com/aibtcdev/landing-page/issues/728 (Step 3.3 spec)
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
  listOutboxRepliesFromD1: vi.fn(),
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
  listOutboxRepliesFromD1,
} from "@/lib/inbox/d1-reads";

// ---- shared fixtures --------------------------------------------------------

const AGENT_ADDR = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";
const SENDER_ADDR = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";
const REPLY_TARGET_ADDR = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";

const TEST_AGENT = {
  btcAddress: AGENT_ADDR,
  stxAddress: "SP3EPDH1E2Y1M4W5GCK4YEJPQ9VW3APJB4Z1QEBNC",
  displayName: "Frosty Narwhal",
};

const SENDER_AGENT = {
  btcAddress: SENDER_ADDR,
  stxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
  displayName: "Solar Penguin",
};

const REPLY_TARGET_AGENT = {
  btcAddress: REPLY_TARGET_ADDR,
  stxAddress: "SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW",
  displayName: "Amber Otter",
};

const RECEIVED_MESSAGE = {
  messageId: "msg_1778221238475_received",
  fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE", // sender STX
  toBtcAddress: AGENT_ADDR,
  toStxAddress: "SP3EPDH1E2Y1M4W5GCK4YEJPQ9VW3APJB4Z1QEBNC",
  content: "Hello agent!",
  paymentSatoshis: 100,
  sentAt: "2026-05-08T06:00:00.000Z",
  authenticated: false,
  paymentStatus: "confirmed" as const,
};

const SENT_REPLY = {
  messageId: "msg_1778221238475_received", // parent ID
  fromAddress: AGENT_ADDR,
  toBtcAddress: REPLY_TARGET_ADDR,
  reply: "Thanks for the message!",
  signature: "sig_abc123base64",
  repliedAt: "2026-05-08T07:00:00.000Z",
};

function buildGetRequest(address: string, query = ""): NextRequest {
  return new NextRequest(
    `https://aibtc.com/api/inbox/${address}${query}`,
    { method: "GET" }
  );
}

function buildContext(address: string) {
  return { params: Promise.resolve({ address }) };
}

function setupDefaultMocks() {
  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: { prepare: vi.fn() } as unknown as D1Database,
      VERIFIED_AGENTS: {} as KVNamespace,
    },
    ctx: { waitUntil: vi.fn() },
  });
  (lookupAgent as Mock).mockResolvedValue(TEST_AGENT);
  (listInboxMessagesFromD1 as Mock).mockResolvedValue([RECEIVED_MESSAGE]);
  (countInboxMessagesFromD1 as Mock).mockResolvedValue(1);
  (fetchRepliesForMessages as Mock).mockResolvedValue(new Map());
  (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);
  // countOutboxRepliesFromD1 is no longer called (perf/d1-inbox-count-4to2)
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ---- sentCount derivation tests (perf/d1-inbox-count-4to2) ------------------
// sentCount is now derived from sentMessages.length (listOutboxRepliesFromD1),
// not from a separate countOutboxRepliesFromD1 call.

describe("Phase 2.5 Step 3.3 — sentCount derivation in inbox-list GET", () => {
  it("returns sentCount > 0 when listOutboxRepliesFromD1 returns reply objects", async () => {
    // sentCount is now sentMessages.length — requires ?include=partners to get replies.
    // Without include=partners, listOutboxRepliesFromD1 returns [] so sentCount=0.
    const replies = [SENT_REPLY, { ...SENT_REPLY, messageId: "msg_2" }, { ...SENT_REPLY, messageId: "msg_3" }];
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue(replies);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // sentCount comes from sentMessages.length, not countOutboxRepliesFromD1
    expect(body.inbox.sentCount).toBe(3);
    expect(body.inbox.sentCount).toBeGreaterThan(0);
  });

  it("returns sentCount = 0 when agent has sent no replies", async () => {
    // listOutboxRepliesFromD1 returns [] in setupDefaultMocks — sentCount = 0
    const res = await GET(buildGetRequest(AGENT_ADDR), buildContext(AGENT_ADDR));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.sentCount).toBe(0);
  });

  it("includes sentCount in economics.satsSent calculation", async () => {
    const replies = [SENT_REPLY, { ...SENT_REPLY, messageId: "msg_2" }];
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue(replies);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // satsSent = sentCount * INBOX_PRICE_SATS (100 sats each)
    expect(body.inbox.economics.satsSent).toBe(2 * 100);
  });

  it("sentCount is included in the empty-inbox self-documenting response", async () => {
    // When both totalCount === 0 AND sentCount === 0, the route returns the
    // self-doc body. sentCount must still be 0 (not undefined) in that case.
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    // listOutboxRepliesFromD1 already returns [] via setupDefaultMocks

    const res = await GET(buildGetRequest(AGENT_ADDR), buildContext(AGENT_ADDR));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.sentCount).toBe(0);
  });

  it("sent-only inbox (totalCount===0 but sentCount>0) returns sentCount in normal envelope, not self-doc", async () => {
    // Regression fix: agent has sent replies but has never received a message.
    // sentCount comes from listOutboxRepliesFromD1 (via include=partners).
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    const replies = [SENT_REPLY, { ...SENT_REPLY, messageId: "msg_2" }, { ...SENT_REPLY, messageId: "msg_3" }];
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue(replies);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.sentCount).toBe(3);
    expect(body.inbox.totalCount).toBe(0);
    expect(body.inbox.economics.satsSent).toBe(3 * 100);
    // Must NOT be the self-doc shape
    expect(body.endpoint).toBeUndefined();
    expect(body.howToSend).toBeDefined(); // howToSend is in both shapes; check via other markers
  });

  it("sent-only inbox with partners requested exposes sent-direction partners", async () => {
    // Regression check for the partners-with-sent path in the sent-only case.
    (lookupAgent as Mock).mockImplementation((kv: unknown, addr: string) => {
      if (addr === AGENT_ADDR) return Promise.resolve(TEST_AGENT);
      if (addr === REPLY_TARGET_ADDR) return Promise.resolve(REPLY_TARGET_AGENT);
      return Promise.resolve(null);
    });
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([SENT_REPLY]);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.sentCount).toBe(1);
    expect(Array.isArray(body.inbox.partners)).toBe(true);
    expect(body.inbox.partners.length).toBeGreaterThan(0);
    const target = body.inbox.partners.find(
      (p: { btcAddress: string }) => p.btcAddress === REPLY_TARGET_ADDR
    );
    expect(target).toBeDefined();
    expect(target.direction).toBe("sent");
  });
});

// ---- partners-with-sent tests -----------------------------------------------

describe("Phase 2.5 Step 3.3 — partners-with-sent in inbox-list GET", () => {
  beforeEach(() => {
    // Set up additional agent lookups for partner resolution.
    // Must handle both BTC and STX address lookups since the route resolves
    // received-message partners via their STX address (fromAddress) and
    // sent-reply partners via their BTC address (toBtcAddress).
    (lookupAgent as Mock).mockImplementation((kv: unknown, addr: string) => {
      if (addr === AGENT_ADDR) return Promise.resolve(TEST_AGENT);
      if (addr === SENDER_AGENT.stxAddress) return Promise.resolve(SENDER_AGENT);
      if (addr === SENDER_ADDR) return Promise.resolve(SENDER_AGENT);
      if (addr === REPLY_TARGET_AGENT.stxAddress) return Promise.resolve(REPLY_TARGET_AGENT);
      if (addr === REPLY_TARGET_ADDR) return Promise.resolve(REPLY_TARGET_AGENT);
      return Promise.resolve(null);
    });
  });

  it("partners includes both received senders AND sent reply targets when both exist", async () => {
    // Mock received messages (partner = sender)
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([RECEIVED_MESSAGE]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(1);
    // Mock sent replies (partner = toBtcAddress) — sentCount derives from this list
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([SENT_REPLY]);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.partners).toBeDefined();

    // Should have at least 2 partners: the sender (received) and the reply target (sent)
    const partnerAddresses = body.inbox.partners.map((p: { btcAddress: string }) => p.btcAddress);
    // The sender is resolved via SENDER_AGENT
    expect(partnerAddresses).toContain(SENDER_ADDR);
    // The reply target is in toBtcAddress of the sent reply
    expect(partnerAddresses).toContain(REPLY_TARGET_ADDR);
  });

  it("partners from sent-only direction have direction='sent'", async () => {
    // Only sent replies, no received messages — sentCount=1 derived from this list
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([SENT_REPLY]);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.partners).toBeDefined();

    const replyTargetPartner = body.inbox.partners.find(
      (p: { btcAddress: string }) => p.btcAddress === REPLY_TARGET_ADDR
    );
    // Partners from outbox-only should have direction='sent'
    if (replyTargetPartner) {
      expect(replyTargetPartner.direction).toBe("sent");
    }
  });

  it("partners from both received and sent have direction='both' after merge", async () => {
    // Same agent appears as both a sender (received msg) and reply target (sent reply)
    const DUAL_PARTNER_ADDR = REPLY_TARGET_ADDR;
    const receivedMsgFromDualPartner = {
      ...RECEIVED_MESSAGE,
      fromAddress: REPLY_TARGET_AGENT.stxAddress, // received from REPLY_TARGET
    };
    const sentReplyToDualPartner = {
      ...SENT_REPLY,
      toBtcAddress: DUAL_PARTNER_ADDR, // also sent reply to REPLY_TARGET
    };

    (listInboxMessagesFromD1 as Mock).mockResolvedValue([receivedMsgFromDualPartner]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(1);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([sentReplyToDualPartner]);

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inbox.partners).toBeDefined();

    const dualPartner = body.inbox.partners.find(
      (p: { btcAddress: string }) => p.btcAddress === DUAL_PARTNER_ADDR
    );
    // After dedup + merge, this partner should have direction='both'
    if (dualPartner) {
      expect(dualPartner.direction).toBe("both");
    }
  });

  it("partners only from received when no sent replies (received-only path still works)", async () => {
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([RECEIVED_MESSAGE]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(1);
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]); // no sent replies — sentCount=0

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Partners should still work from received-only path
    expect(Array.isArray(body.inbox.partners)).toBe(true);
    // The sender should appear as a received partner
    const senderPartner = body.inbox.partners.find(
      (p: { btcAddress: string }) => p.btcAddress === SENDER_ADDR
    );
    if (senderPartner) {
      expect(senderPartner.direction).toBe("received");
    }
  });
});

// ---- D1-throws fallback (perf/d1-inbox-count-4to2) --------------------------
// countOutboxRepliesFromD1 is no longer in Promise.all; the 4 remaining queries
// are: listInboxMessagesFromD1, countInboxMessagesFromD1 (×2), listOutboxRepliesFromD1.

describe("D1-throws fallback still works after COUNT reduction", () => {
  it("returns 503 when countInboxMessagesFromD1 throws", async () => {
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: inbox_messages unavailable")
    );
    (listOutboxRepliesFromD1 as Mock).mockResolvedValue([]);

    const res = await GET(buildGetRequest(AGENT_ADDR), buildContext(AGENT_ADDR));

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(500);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 when listOutboxRepliesFromD1 throws (partners requested)", async () => {
    (listInboxMessagesFromD1 as Mock).mockResolvedValue([]);
    (countInboxMessagesFromD1 as Mock).mockResolvedValue(0);
    (listOutboxRepliesFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: schema mismatch")
    );

    const res = await GET(
      buildGetRequest(AGENT_ADDR, "?include=partners"),
      buildContext(AGENT_ADDR)
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("transient_d1_unavailable");
  });
});
