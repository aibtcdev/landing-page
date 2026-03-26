import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapRPCErrorCode, submitViaRPC } from "../relay-rpc";
import type { RelayRPC, RelaySubmitParams } from "../relay-rpc";
import type { Logger } from "@/lib/logging";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const baseParams: RelaySubmitParams = {
  transaction: "aabbccdd112233445566778899001122334455667788990011223344556677889900",
  settle: {
    expectedRecipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    minAmount: "100",
    tokenType: "sBTC",
  },
};

describe("mapRPCErrorCode", () => {
  describe("undefined and empty input", () => {
    it("returns RELAY_ERROR for undefined code", () => {
      expect(mapRPCErrorCode(undefined)).toBe("RELAY_ERROR");
    });

    it("returns RELAY_ERROR for empty string code", () => {
      expect(mapRPCErrorCode("")).toBe("RELAY_ERROR");
    });
  });

  describe("SENDER_NONCE_* codes", () => {
    it("maps SENDER_NONCE_STALE to SENDER_NONCE_STALE", () => {
      expect(mapRPCErrorCode("SENDER_NONCE_STALE")).toBe("SENDER_NONCE_STALE");
    });

    it("maps SENDER_NONCE_DUPLICATE to SENDER_NONCE_DUPLICATE", () => {
      expect(mapRPCErrorCode("SENDER_NONCE_DUPLICATE")).toBe("SENDER_NONCE_DUPLICATE");
    });

    it("maps SENDER_NONCE_GAP to SENDER_NONCE_GAP", () => {
      expect(mapRPCErrorCode("SENDER_NONCE_GAP")).toBe("SENDER_NONCE_GAP");
    });
  });

  describe("broadcast error codes", () => {
    it("maps BROADCAST_FAILED to BROADCAST_FAILED", () => {
      expect(mapRPCErrorCode("BROADCAST_FAILED")).toBe("BROADCAST_FAILED");
    });

    it("maps TX_BROADCAST_ERROR to BROADCAST_FAILED", () => {
      expect(mapRPCErrorCode("TX_BROADCAST_ERROR")).toBe("BROADCAST_FAILED");
    });
  });

  describe("settlement error codes", () => {
    it("maps SETTLEMENT_FAILED to SETTLEMENT_FAILED", () => {
      expect(mapRPCErrorCode("SETTLEMENT_FAILED")).toBe("SETTLEMENT_FAILED");
    });
  });

  describe("funds error codes", () => {
    it("maps INSUFFICIENT_FUNDS to INSUFFICIENT_FUNDS", () => {
      expect(mapRPCErrorCode("INSUFFICIENT_FUNDS")).toBe("INSUFFICIENT_FUNDS");
    });

    it("maps BALANCE_ERROR to INSUFFICIENT_FUNDS", () => {
      expect(mapRPCErrorCode("BALANCE_ERROR")).toBe("INSUFFICIENT_FUNDS");
    });
  });

  describe("nonce conflict codes", () => {
    it("maps NONCE_CONFLICT to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("NONCE_CONFLICT")).toBe("NONCE_CONFLICT");
    });

    it("maps CLIENT_NONCE_CONFLICT to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("CLIENT_NONCE_CONFLICT")).toBe("NONCE_CONFLICT");
    });

    it("maps CLIENT_BAD_NONCE to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("CLIENT_BAD_NONCE")).toBe("NONCE_CONFLICT");
    });

    it("maps TOO_MUCH_CHAINING to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("TOO_MUCH_CHAINING")).toBe("NONCE_CONFLICT");
    });
  });

  describe("unknown codes", () => {
    it("returns RELAY_ERROR for unrecognized code", () => {
      expect(mapRPCErrorCode("COMPLETELY_UNKNOWN_CODE")).toBe("RELAY_ERROR");
    });

    it("returns RELAY_ERROR for partially matching code", () => {
      expect(mapRPCErrorCode("SENDER_NONCE_UNKNOWN")).toBe("RELAY_ERROR");
    });
  });
});

describe("submitViaRPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("submitPayment rejection — pre-enqueue", () => {
    it("returns failure when submitPayment is rejected with SENDER_NONCE_STALE", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_STALE",
          error: "nonce is stale",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_STALE");
      expect(result.relayCode).toBe("SENDER_NONCE_STALE");
      expect(result.relayDetail).toBe("nonce is stale");
      expect(rpc.checkPayment).not.toHaveBeenCalled();
    });

    it("returns failure when submitPayment is rejected with SENDER_NONCE_DUPLICATE", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_DUPLICATE",
          error: "duplicate nonce in queue",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_DUPLICATE");
    });

    it("returns failure when submitPayment is rejected with SENDER_NONCE_GAP", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_GAP",
          error: "nonce gap detected",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_GAP");
    });

    it("returns RELAY_ERROR when submitPayment is rejected without code", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          error: "unknown rejection reason",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("RELAY_ERROR");
      expect(result.error).toBe("unknown rejection reason");
    });

    it("includes retryAfterSeconds when submitPayment returns retryAfter", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_DUPLICATE",
          error: "already queued",
          retryAfter: 5,
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.retryAfterSeconds).toBe(5);
    });

    it("omits retryAfterSeconds when submitPayment does not include retryAfter", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_STALE",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it("uses default error message when submitPayment rejection has no error field", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseParams, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Payment submission rejected by relay");
    });
  });

  describe("successful settlement paths", () => {
    it("returns success on confirmed payment with sender and txid", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-001",
          status: "confirmed",
          txid: "abc123txid",
          settlement: {
            status: "confirmed",
            sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
            recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
            amount: "100",
          },
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.payerStxAddress).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result.paymentTxid).toBe("abc123txid");
      expect(result.paymentStatus).toBe("confirmed");
      expect(rpc.checkPayment).toHaveBeenCalledWith("pay-001");
    });

    it("returns paymentStatus pending when settlement.status is pending", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-002",
          status: "confirmed",
          txid: "pendingTxid",
          settlement: {
            status: "pending",
            sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
          },
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe("pending");
      expect(result.paymentTxid).toBe("pendingTxid");
    });

    it("includes receiptId when checkPayment returns one", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-003",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-003",
          status: "confirmed",
          txid: "txidWithReceipt",
          receiptId: "rcpt-abc",
          settlement: {
            status: "confirmed",
            sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
          },
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.receiptId).toBe("rcpt-abc");
    });

    it("handles missing sender in settlement (returns empty string)", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-004",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-004",
          status: "confirmed",
          txid: "txidNoSender",
          settlement: { status: "confirmed" },
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.payerStxAddress).toBe("");
    });
  });

  describe("failed settlement from checkPayment", () => {
    it("returns failure when checkPayment returns status failed", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-001",
          status: "failed",
          code: "BROADCAST_FAILED",
          error: "tx rejected by mempool",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("BROADCAST_FAILED");
      expect(result.relayCode).toBe("BROADCAST_FAILED");
      expect(result.relayDetail).toBe("tx rejected by mempool");
    });

    it("returns RELAY_ERROR when checkPayment fails without code", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-002",
          status: "failed",
          error: "internal relay error",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("RELAY_ERROR");
    });

    it("uses default error message when failed check has no error field", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-003",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-003",
          status: "failed",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Payment settlement failed");
    });
  });

  describe("relay timeout response", () => {
    it("returns SETTLEMENT_TIMEOUT when checkPayment returns timeout status", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-timeout-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-timeout-001",
          status: "timeout",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(result.error).toContain("paymentTxid");
    });

    it("includes receiptId in timeout result when checkPayment provides one", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-timeout-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-timeout-002",
          status: "timeout",
          receiptId: "rcpt-timeout-xyz",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(result.receiptId).toBe("rcpt-timeout-xyz");
    });
  });

  describe("poll exhaustion", () => {
    it("returns SETTLEMENT_TIMEOUT when all poll attempts return queued", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-001",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(result.error).toContain("paymentTxid");
      // Should have polled exactly RPC_POLL_MAX_ATTEMPTS (8) times
      expect(rpc.checkPayment).toHaveBeenCalledTimes(8);
    });

    it("returns SETTLEMENT_TIMEOUT when all poll attempts return processing", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-002",
          status: "processing",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(8);
    });
  });

  describe("multi-poll — confirmed after several attempts", () => {
    it("succeeds after polling through queued and processing states", async () => {
      let callCount = 0;
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-multi-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return { paymentId: "pay-multi-001", status: "queued" };
          if (callCount === 2) return { paymentId: "pay-multi-001", status: "processing" };
          return {
            paymentId: "pay-multi-001",
            status: "confirmed",
            txid: "multi-poll-txid",
            settlement: {
              status: "confirmed",
              sender: "SPMultiPollSender",
            },
          };
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("multi-poll-txid");
      expect(result.payerStxAddress).toBe("SPMultiPollSender");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(3);
    });
  });

  describe("submitPayment throwing (RPC exception)", () => {
    it("re-throws when submitPayment rejects with an exception", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockRejectedValue(new Error("RPC connection refused")),
        checkPayment: vi.fn(),
      };

      await expect(submitViaRPC(rpc, baseParams, mockLogger)).rejects.toThrow(
        "RPC connection refused"
      );
    });
  });

  describe("checkPayment throwing (RPC exception)", () => {
    it("re-throws when checkPayment rejects with an exception", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-throw-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockRejectedValue(new Error("RPC stream closed")),
      };

      // Attach the rejection handler synchronously before running timers
      // to avoid the PromiseRejectionHandledWarning unhandled rejection.
      const resultPromise = expect(
        submitViaRPC(rpc, baseParams, mockLogger)
      ).rejects.toThrow("RPC stream closed");
      await vi.runAllTimersAsync();
      await resultPromise;
    });
  });

  describe("logging behavior", () => {
    it("logs debug on submit and on each poll check", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-001",
          status: "confirmed",
          txid: "log-txid",
          settlement: { status: "confirmed", sender: "SPLogSender" },
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: submitting payment",
        expect.objectContaining({ transaction: expect.stringContaining("...") })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: payment queued",
        { paymentId: "pay-log-001" }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: checkPayment",
        expect.objectContaining({ attempt: 0, paymentId: "pay-log-001", status: "confirmed" })
      );
    });

    it("logs warn on submitPayment rejection", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "",
          status: "rejected",
          code: "SENDER_NONCE_STALE",
          error: "stale nonce",
        }),
        checkPayment: vi.fn(),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "RPC: submitPayment rejected",
        expect.objectContaining({ code: "SENDER_NONCE_STALE" })
      );
    });

    it("logs warn on poll exhaustion", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-exhaust",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-exhaust",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseParams, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "RPC: poll max attempts reached",
        expect.objectContaining({ paymentId: "pay-log-exhaust" })
      );
    });
  });
});
