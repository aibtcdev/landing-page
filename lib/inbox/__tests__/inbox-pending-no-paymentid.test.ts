/**
 * Focused tests for inbox POST canonical-identity handling around staged payments.
 *
 * Phase 3 contract:
 * - pending without relay-owned paymentId must fail closed
 * - pending with relay-owned paymentId stays staged and must not claim delivery
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockKVWithOptions } from "./kv-mock";
import { X402_HEADERS, networkToCAIP2 } from "x402-stacks";

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  lookupAgent: vi.fn(),
  validateInboxMessage: vi.fn(),
  verifyInboxPayment: vi.fn(),
  verifyTxidPayment: vi.fn(),
  storeMessage: vi.fn(),
  storeStagedInboxPayment: vi.fn(),
  updateAgentInbox: vi.fn(),
  updateSentIndex: vi.fn(),
  listInboxMessages: vi.fn(),
  listSentMessages: vi.fn(),
  buildInboxPaymentRequirements: vi.fn(),
  buildSenderAuthMessage: vi.fn(),
  checkSenderRateLimit: vi.fn(),
  enqueueInboxReconciliation: vi.fn(),
  verifyBitcoinSignature: vi.fn(),
  hasAchievement: vi.fn(),
  grantAchievement: vi.fn(),
  invalidateAgentListCache: vi.fn(),
  getPaymentRepoVersion: vi.fn(),
  logPaymentEvent: vi.fn(),
  queueSend: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: mocks.lookupAgent,
}));

vi.mock("@/lib/inbox", () => ({
  validateInboxMessage: mocks.validateInboxMessage,
  verifyInboxPayment: mocks.verifyInboxPayment,
  verifyTxidPayment: mocks.verifyTxidPayment,
  storeMessage: mocks.storeMessage,
  storeStagedInboxPayment: mocks.storeStagedInboxPayment,
  updateAgentInbox: mocks.updateAgentInbox,
  updateSentIndex: mocks.updateSentIndex,
  listInboxMessages: mocks.listInboxMessages,
  listSentMessages: mocks.listSentMessages,
  buildInboxPaymentRequirements: mocks.buildInboxPaymentRequirements,
  buildSenderAuthMessage: mocks.buildSenderAuthMessage,
  checkSenderRateLimit: mocks.checkSenderRateLimit,
  enqueueInboxReconciliation: mocks.enqueueInboxReconciliation,
  INBOX_PRICE_SATS: 100,
  REDEEMED_TXID_TTL_SECONDS: 7776000,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS: 120,
  DEFAULT_RELAY_URL: "https://x402-relay.aibtc.com",
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: mocks.verifyBitcoinSignature,
}));

vi.mock("@/lib/achievements", () => ({
  hasAchievement: mocks.hasAchievement,
  grantAchievement: mocks.grantAchievement,
}));

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: mocks.invalidateAgentListCache,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => mocks.logger,
  createConsoleLogger: () => mocks.logger,
  isLogsRPC: () => false,
}));

vi.mock("@/lib/inbox/payment-logging", () => ({
  getPaymentRepoVersion: mocks.getPaymentRepoVersion,
  logPaymentEvent: mocks.logPaymentEvent,
}));

// Import POST after all mocks are registered
const { POST } = await import("@/app/api/inbox/[address]/route");

const RECIPIENT_BTC = "bc1qrecipient000000000000000000000000test";
const RECIPIENT_STX = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const SENDER_STX = "SP1SENDER0000000000000000000000000000TEST";
const NETWORK = "mainnet";

describe("inbox POST canonical staged-payment semantics", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockKV = createMockKVWithOptions();
    kv = mockKV.kv;

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_NETWORK: NETWORK,
        X402_RELAY_URL: "https://x402-relay.aibtc.com",
        INBOX_RECONCILIATION_QUEUE: {
          send: mocks.queueSend,
        },
      },
      ctx: {},
    });

    // Recipient agent exists with full registration
    mocks.lookupAgent
      .mockResolvedValueOnce({
        btcAddress: RECIPIENT_BTC,
        stxAddress: RECIPIENT_STX,
        displayName: "TestAgent",
      })
      // Second call for sender agent lookup (returns null — anonymous sender)
      .mockResolvedValueOnce(null);

    // Message body passes validation
    mocks.validateInboxMessage.mockReturnValue({
      data: {
        toBtcAddress: RECIPIENT_BTC,
        toStxAddress: RECIPIENT_STX,
        content: "Hello from pending test",
      },
    });

    mocks.buildInboxPaymentRequirements.mockReturnValue({
      scheme: "exact",
      network: networkToCAIP2(NETWORK),
      maxAmountRequired: "100",
      resource: "https://aibtc.com/api/inbox/test",
      description: "test",
    });

    // Relay returns pending WITHOUT paymentId — this must now fail closed.
    mocks.verifyInboxPayment.mockResolvedValue({
      success: true,
      payerStxAddress: SENDER_STX,
      paymentTxid: "a".repeat(64),
      relayCode: "RELAY_CONTRACT_VIOLATION",
      relayDetail: "accepted pending payment missing paymentId",
      settleResult: {
        success: true,
        transaction: "a".repeat(64),
        payer: SENDER_STX,
        network: networkToCAIP2(NETWORK),
      },
      paymentStatus: "pending",
      // NOTE: no paymentId — canonical identity is missing
    });

    mocks.checkSenderRateLimit.mockResolvedValue(null);
    mocks.storeMessage.mockResolvedValue(undefined);
    mocks.updateAgentInbox.mockResolvedValue(undefined);
    mocks.hasAchievement.mockResolvedValue(true);
    mocks.grantAchievement.mockResolvedValue(undefined);
    mocks.invalidateAgentListCache.mockResolvedValue(undefined);
    mocks.getPaymentRepoVersion.mockReturnValue("0.3.0");
    mocks.queueSend.mockResolvedValue(undefined);
    mocks.enqueueInboxReconciliation.mockResolvedValue(true);
  });

  function buildRequest(): NextRequest {
    // Build a valid x402 payment-signature header (base64-encoded JSON).
    // accepted must include all required fields (scheme, network, amount, asset, payTo)
    // so that HttpPaymentPayloadSchema.safeParse succeeds in the route before reaching
    // the mocked verifyInboxPayment. verifyInboxPayment is mocked so asset value is irrelevant.
    const paymentPayload = {
      payload: { transaction: "a".repeat(64) },
      accepted: {
        scheme: "exact",
        network: networkToCAIP2(NETWORK),
        amount: "100",
        asset: `SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-token::sbtc-token`,
        payTo: RECIPIENT_STX,
      },
      resource: { url: `https://aibtc.com/api/inbox/${RECIPIENT_BTC}` },
    };
    const paymentSigHeader = btoa(JSON.stringify(paymentPayload));

    return new NextRequest(`https://aibtc.com/api/inbox/${RECIPIENT_BTC}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [X402_HEADERS.PAYMENT_SIGNATURE]: paymentSigHeader,
      },
      body: JSON.stringify({
        toBtcAddress: RECIPIENT_BTC,
        toStxAddress: RECIPIENT_STX,
        content: "Hello from pending test",
      }),
    });
  }

  it("returns 502 when relay reports pending without paymentId", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(response.status).toBe(502);
  });

  it("does not create a staged payment record", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.storeStagedInboxPayment).not.toHaveBeenCalled();
  });

  it("does not store the message for delivery when canonical identity is missing", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.storeMessage).not.toHaveBeenCalled();
    expect(mocks.updateAgentInbox).not.toHaveBeenCalled();
  });

  it("returns a fail-closed error body when canonical identity is missing", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    const body = (await response.json()) as {
      code: string;
      error: string;
      nextSteps: string;
      relayCode?: string;
      relayDetail?: string;
    };
    expect(body.code).toBe("MISSING_CANONICAL_IDENTITY");
    expect(body.error).toContain("did not return a canonical payment identity");
    expect(body.nextSteps).toContain("Do not assume delivery");
    expect(body.relayCode).toBe("RELAY_CONTRACT_VIOLATION");
    expect(body.relayDetail).toBe("accepted pending payment missing paymentId");
  });

  it("response headers omit X-Payment-Id", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(response.headers.get("X-Payment-Id")).toBeNull();
    expect(response.headers.get("X-Payment-Check-Url")).toBeNull();
  });

  it("logs the fail-closed missing-identity event", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.logPaymentEvent).toHaveBeenCalledWith(
      mocks.logger,
      "error",
      "payment.fallback_used",
      expect.any(String),
      expect.objectContaining({
        paymentId: null,
        status: "pending",
        action: "reject_pending_without_canonical_identity",
      })
    );
  });

  it("returns 202 staged wording and avoids delivery language when canonical paymentId is present", async () => {
    mocks.verifyInboxPayment.mockResolvedValueOnce({
      success: true,
      payerStxAddress: SENDER_STX,
      paymentTxid: "a".repeat(64),
      settleResult: {
        success: true,
        transaction: "a".repeat(64),
        payer: SENDER_STX,
        network: networkToCAIP2(NETWORK),
      },
      paymentStatus: "pending",
      paymentId: "pay_staged_case",
      checkStatusUrl: "https://relay.example/check/pay_staged_case",
    });

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });
    const body = (await response.json()) as {
      message: string;
      inbox: { paymentStatus: string; paymentId?: string };
      checkStatusUrl?: string;
    };

    expect(response.status).toBe(202);
    expect(body.message).toBe(
      "Payment accepted. Inbox delivery is staged until the relay reports confirmed."
    );
    expect(body.message).not.toContain("Message sent successfully");
    expect(body.inbox.paymentStatus).toBe("pending");
    expect(body.inbox.paymentId).toBe("pay_staged_case");
    expect(body.checkStatusUrl).toBe("https://relay.example/check/pay_staged_case");
    expect(mocks.storeStagedInboxPayment).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueInboxReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        send: mocks.queueSend,
      }),
      expect.objectContaining({
        paymentId: "pay_staged_case",
        attempt: 0,
        source: "inbox_post",
      }),
      mocks.logger,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        messageId: expect.any(String),
        workerStage: "http_inbox_post",
      })
    );
    expect(mocks.storeMessage).not.toHaveBeenCalled();
  });
});
