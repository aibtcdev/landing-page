import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getMessage, getStagedInboxPayment, storeStagedInboxPayment } from "@/lib/inbox";
import { createMockKV } from "./kv-mock";
import { GET } from "@/app/api/payment-status/[paymentId]/route";

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  invalidateAgentListCache: vi.fn(),
  hasAchievement: vi.fn(),
  grantAchievement: vi.fn(),
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

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: mocks.invalidateAgentListCache,
}));

vi.mock("@/lib/achievements", () => ({
  hasAchievement: mocks.hasAchievement,
  grantAchievement: mocks.grantAchievement,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => mocks.logger,
  createConsoleLogger: () => mocks.logger,
  isLogsRPC: () => false,
}));

describe("payment-status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAchievement.mockResolvedValue(true);
    mocks.grantAchievement.mockResolvedValue(undefined);
    mocks.invalidateAgentListCache.mockResolvedValue(undefined);
  });

  async function stagePendingPayment(kv: KVNamespace, paymentId: string, messageId: string) {
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId,
      createdAt: sentAt,
      message: {
        messageId,
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId,
      },
    });
  }

  it("normalizes submitted to queued in caller-facing payloads", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_submitted_case",
            status: "submitted",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_submitted_case"),
      { params: Promise.resolve({ paymentId: "pay_submitted_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_submitted_case",
        status: "queued",
      })
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "payment.fallback_used",
      expect.objectContaining({
        route: "/api/payment-status/pay_submitted_case",
        paymentId: "pay_submitted_case",
        status: "submitted",
        action: "collapse_submitted_to_queued",
        compat_shim_used: true,
      })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.poll",
      expect.objectContaining({
        route: "/api/payment-status/pay_submitted_case",
        paymentId: "pay_submitted_case",
        status: "queued",
        action: "continue_polling",
        checkStatusUrl_present: true,
      })
    );
  });

  it("prefers relay-provided checkStatusUrl when the shared contract includes it", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_hint_case",
            status: "queued",
            checkStatusUrl: "https://relay.example/check/pay_hint_case",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_hint_case"),
      { params: Promise.resolve({ paymentId: "pay_hint_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_hint_case",
        status: "queued",
        checkStatusUrl: "https://relay.example/check/pay_hint_case",
      })
    );
  });

  it("prefers relay-provided checkStatusUrl for canonical not_found responses", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_not_found_hint_case",
            status: "not_found",
            terminalReason: "unknown_payment_identity",
            checkStatusUrl: "https://relay.example/check/pay_not_found_hint_case",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_not_found_hint_case"),
      { params: Promise.resolve({ paymentId: "pay_not_found_hint_case" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_not_found_hint_case",
        status: "not_found",
        terminalReason: "unknown_payment_identity",
        checkStatusUrl: "https://relay.example/check/pay_not_found_hint_case",
      })
    );
  });

  it("falls back to the local payment-status route when relay omits checkStatusUrl", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_local_fallback_case",
            status: "queued",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_local_fallback_case"),
      { params: Promise.resolve({ paymentId: "pay_local_fallback_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_local_fallback_case",
        status: "queued",
        checkStatusUrl: "/api/payment-status/pay_local_fallback_case",
      })
    );
  });

  it("finalizes staged inbox records on confirmed", async () => {
    const kv = createMockKV();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_finalize_case",
      createdAt: sentAt,
      senderSentIndexBtcAddress: "bc1sender",
      message: {
        messageId: "msg_finalize_case",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_finalize_case",
      },
    });

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_finalize_case",
            status: "confirmed",
            txid: "a".repeat(64),
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_finalize_case"),
      { params: Promise.resolve({ paymentId: "pay_finalize_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_finalize_case",
        status: "confirmed",
        txid: "a".repeat(64),
      })
    );
    expect(await getStagedInboxPayment(kv, "pay_finalize_case")).toBeNull();
    expect(await getMessage(kv, "msg_finalize_case")).toEqual(
      expect.objectContaining({
        messageId: "msg_finalize_case",
        paymentStatus: "confirmed",
        paymentTxid: "a".repeat(64),
      })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.delivery_confirmed",
      expect.objectContaining({
        route: "/api/payment-status/pay_finalize_case",
        paymentId: "pay_finalize_case",
        status: "confirmed",
        action: "finalize_staged_delivery",
      })
    );
  });

  it("discards staged inbox records on terminal non-success states", async () => {
    const kv = createMockKV();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_discard_case",
      createdAt: sentAt,
      message: {
        messageId: "msg_discard_case",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_discard_case",
      },
    });

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_discard_case",
            status: "failed",
            terminalReason: "sender_nonce_stale",
            errorCode: "SENDER_NONCE_STALE",
            error: "stale nonce",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_discard_case"),
      { params: Promise.resolve({ paymentId: "pay_discard_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_discard_case",
        status: "failed",
        terminalReason: "sender_nonce_stale",
      })
    );
    expect(await getStagedInboxPayment(kv, "pay_discard_case")).toBeNull();
    expect(await getMessage(kv, "msg_discard_case")).toBeNull();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.delivery_discarded",
      expect.objectContaining({
        route: "/api/payment-status/pay_discard_case",
        paymentId: "pay_discard_case",
        status: "failed",
        terminalReason: "sender_nonce_stale",
        action: "discard_staged_delivery",
      })
    );
  });

  it("surfaces sender nonce gap terminal metadata from relay polling", async () => {
    const kv = createMockKV();
    await stagePendingPayment(kv, "pay_sender_gap_case", "msg_sender_gap_case");

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_sender_gap_case",
            status: "failed",
            terminalReason: "sender_nonce_gap",
            errorCode: "SENDER_NONCE_GAP",
            error: "sender nonce gap detected",
            checkStatusUrl: "https://relay.example/check/pay_sender_gap_case",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_sender_gap_case"),
      { params: Promise.resolve({ paymentId: "pay_sender_gap_case" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_sender_gap_case",
        status: "failed",
        terminalReason: "sender_nonce_gap",
        errorCode: "SENDER_NONCE_GAP",
        error: "sender nonce gap detected",
        checkStatusUrl: "https://relay.example/check/pay_sender_gap_case",
      })
    );
    expect(await getStagedInboxPayment(kv, "pay_sender_gap_case")).toBeNull();
    expect(await getMessage(kv, "msg_sender_gap_case")).toBeNull();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.delivery_discarded",
      expect.objectContaining({
        route: "/api/payment-status/pay_sender_gap_case",
        paymentId: "pay_sender_gap_case",
        status: "failed",
        terminalReason: "sender_nonce_gap",
        action: "discard_staged_delivery",
      })
    );
  });

  it("returns HTTP 404 on canonical not_found", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_not_found_status_case",
            status: "not_found",
            terminalReason: "expired",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_not_found_status_case"),
      { params: Promise.resolve({ paymentId: "pay_not_found_status_case" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns canonical body fields on not_found", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_not_found_body_case",
            status: "not_found",
            terminalReason: "expired",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_not_found_body_case"),
      { params: Promise.resolve({ paymentId: "pay_not_found_body_case" }) }
    );

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_not_found_body_case",
        status: "not_found",
        terminalReason: "expired",
        checkStatusUrl: "/api/payment-status/pay_not_found_body_case",
      })
    );
  });

  it("discards staged inbox records on not_found", async () => {
    const kv = createMockKV();
    await stagePendingPayment(kv, "pay_not_found_case", "msg_not_found_case");

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_not_found_case",
            status: "not_found",
            terminalReason: "expired",
            error: "Payment pay_not_found_case not found or expired",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_not_found_case"),
      { params: Promise.resolve({ paymentId: "pay_not_found_case" }) }
    );

    expect(response.status).toBe(404);
    expect(await getStagedInboxPayment(kv, "pay_not_found_case")).toBeNull();
    expect(await getMessage(kv, "msg_not_found_case")).toBeNull();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.delivery_discarded",
      expect.objectContaining({
        route: "/api/payment-status/pay_not_found_case",
        paymentId: "pay_not_found_case",
        status: "not_found",
        terminalReason: "expired",
        action: "discard_staged_delivery",
      })
    );
  });

  it("discards staged inbox records on canonical unknown_payment_identity not_found", async () => {
    const kv = createMockKV();
    await stagePendingPayment(kv, "pay_not_found_terminal_case", "msg_not_found_terminal_case");

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_not_found_terminal_case",
            status: "not_found",
            terminalReason: "unknown_payment_identity",
            error: "Payment pay_not_found_terminal_case not found or expired",
            checkStatusUrl: "https://relay.example/check/pay_not_found_terminal_case",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_not_found_terminal_case"),
      { params: Promise.resolve({ paymentId: "pay_not_found_terminal_case" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        paymentId: "pay_not_found_terminal_case",
        status: "not_found",
        terminalReason: "unknown_payment_identity",
        checkStatusUrl: "https://relay.example/check/pay_not_found_terminal_case",
      })
    );
    expect(await getStagedInboxPayment(kv, "pay_not_found_terminal_case")).toBeNull();
    expect(await getMessage(kv, "msg_not_found_terminal_case")).toBeNull();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.delivery_discarded",
      expect.objectContaining({
        route: "/api/payment-status/pay_not_found_terminal_case",
        paymentId: "pay_not_found_terminal_case",
        status: "not_found",
        terminalReason: "unknown_payment_identity",
        action: "discard_staged_delivery",
      })
    );
  });

  it("logs malformed relay poll payloads before schema parse failure", async () => {
    const kv = createMockKV();
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_malformed_case",
          }),
        },
      },
      ctx: {},
    });

    const response = await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_malformed_case"),
      { params: Promise.resolve({ paymentId: "pay_malformed_case" }) }
    );

    expect(response.status).toBe(500);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "payment.poll",
      expect.objectContaining({
        route: "/api/payment-status/pay_malformed_case",
        paymentId: "pay_malformed_case",
        status: "malformed",
        action: "relay_poll_payload_missing_fields",
      })
    );
  });

  it("finalizes a confirmed staged payment exactly once across repeated polls", async () => {
    const kv = createMockKV();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_once_case",
      createdAt: sentAt,
      senderSentIndexBtcAddress: "bc1sender",
      message: {
        messageId: "msg_once_case",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_once_case",
      },
    });

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        VERIFIED_AGENTS: kv,
        X402_RELAY: {
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_once_case",
            status: "confirmed",
            txid: "b".repeat(64),
          }),
        },
      },
      ctx: {},
    });

    await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_once_case"),
      { params: Promise.resolve({ paymentId: "pay_once_case" }) }
    );
    await GET(
      new NextRequest("https://aibtc.com/api/payment-status/pay_once_case"),
      { params: Promise.resolve({ paymentId: "pay_once_case" }) }
    );

    expect(await getStagedInboxPayment(kv, "pay_once_case")).toBeNull();
    expect(await getMessage(kv, "msg_once_case")).toEqual(
      expect.objectContaining({
        messageId: "msg_once_case",
        paymentStatus: "confirmed",
        paymentTxid: "b".repeat(64),
      })
    );
    expect(
      mocks.logger.info.mock.calls.filter(([message]) => message === "payment.delivery_confirmed")
    ).toHaveLength(1);
  });
});
