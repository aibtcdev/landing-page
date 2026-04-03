/**
 * Focused test for the pending-without-paymentId compat fallback in the inbox POST route.
 *
 * When the relay accepts payment but returns paymentStatus: "pending" without a paymentId,
 * the route falls back to immediate 201 delivery instead of 202 staged. This test verifies:
 * - Response is 201 (not 202)
 * - No paymentId in response body
 * - No storeStagedInboxPayment call
 * - Warning logged about the compat fallback
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
  verifyBitcoinSignature: vi.fn(),
  hasAchievement: vi.fn(),
  grantAchievement: vi.fn(),
  invalidateAgentListCache: vi.fn(),
  getPaymentRepoVersion: vi.fn(),
  logPaymentEvent: vi.fn(),
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

describe("inbox POST: pending-without-paymentId compat fallback", () => {
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

    // Relay returns pending WITHOUT paymentId — the compat fallback
    mocks.verifyInboxPayment.mockResolvedValue({
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
      // NOTE: no paymentId — this is the compat case
    });

    mocks.checkSenderRateLimit.mockResolvedValue(null);
    mocks.storeMessage.mockResolvedValue(undefined);
    mocks.updateAgentInbox.mockResolvedValue(undefined);
    mocks.hasAchievement.mockResolvedValue(true);
    mocks.grantAchievement.mockResolvedValue(undefined);
    mocks.invalidateAgentListCache.mockResolvedValue(undefined);
    mocks.getPaymentRepoVersion.mockReturnValue("0.3.0");
  });

  function buildRequest(): NextRequest {
    // Build a valid x402 payment-signature header (base64-encoded JSON)
    const paymentPayload = {
      payload: { transaction: "a".repeat(64) },
      accepted: { asset: `eip155:1/slip44:5757::${RECIPIENT_STX}.sbtc-token::sbtc` },
      resource: { url: `https://aibtc.com/api/inbox/${RECIPIENT_BTC}`, network: networkToCAIP2(NETWORK) },
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

  it("returns 201 (not 202) when relay reports pending without paymentId", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(response.status).toBe(201);
  });

  it("does not create a staged payment record", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.storeStagedInboxPayment).not.toHaveBeenCalled();
  });

  it("stores the message for immediate delivery", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.storeMessage).toHaveBeenCalledTimes(1);
    expect(mocks.updateAgentInbox).toHaveBeenCalledTimes(1);
  });

  it("response body omits paymentId", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    const body = (await response.json()) as {
      success: boolean;
      inbox: { paymentId?: string; paymentStatus?: string };
    };
    expect(body.success).toBe(true);
    expect(body.inbox).toBeDefined();
    expect(body.inbox.paymentId).toBeUndefined();
    expect(body.inbox.paymentStatus).toBe("pending");
  });

  it("response headers omit X-Payment-Id", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(response.headers.get("X-Payment-Id")).toBeNull();
    expect(response.headers.get("X-Payment-Check-Url")).toBeNull();
  });

  it("logs the compat fallback warning", async () => {
    await POST(buildRequest(), {
      params: Promise.resolve({ address: RECIPIENT_BTC }),
    });

    expect(mocks.logPaymentEvent).toHaveBeenCalledWith(
      mocks.logger,
      "warn",
      "payment.fallback_used",
      expect.any(String),
      expect.objectContaining({
        paymentId: null,
        status: "pending",
        action: "deliver_immediately_without_payment_id",
      })
    );
  });
});
