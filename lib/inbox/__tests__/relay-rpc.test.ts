import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapRPCErrorCode, submitViaRPC } from "../relay-rpc";
import type { RelayRPC, RelaySettleOptions } from "../relay-rpc";
import type { Logger } from "@/lib/logging";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const baseTxHex = "aabbccdd112233445566778899001122334455667788990011223344556677889900";
const baseSettle: RelaySettleOptions = {
  expectedRecipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  minAmount: "100",
  tokenType: "sBTC",
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

  describe("validation error codes", () => {
    it("maps INVALID_TRANSACTION to PAYMENT_REJECTED", () => {
      expect(mapRPCErrorCode("INVALID_TRANSACTION")).toBe("PAYMENT_REJECTED");
    });

    it("maps NOT_SPONSORED to PAYMENT_REJECTED", () => {
      expect(mapRPCErrorCode("NOT_SPONSORED")).toBe("PAYMENT_REJECTED");
    });
  });

  describe("internal error codes", () => {
    it("maps INTERNAL_ERROR to RELAY_ERROR", () => {
      expect(mapRPCErrorCode("INTERNAL_ERROR")).toBe("RELAY_ERROR");
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
          accepted: false,
          code: "SENDER_NONCE_STALE",
          error: "nonce is stale",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_STALE");
      expect(result.relayCode).toBe("SENDER_NONCE_STALE");
      expect(result.relayDetail).toBe("nonce is stale");
      expect(rpc.checkPayment).not.toHaveBeenCalled();
    });

    it("returns failure when submitPayment is rejected with SENDER_NONCE_DUPLICATE", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: false,
          code: "SENDER_NONCE_DUPLICATE",
          error: "duplicate nonce in queue",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_DUPLICATE");
    });

    it("returns failure when submitPayment is rejected with INVALID_TRANSACTION", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: false,
          code: "INVALID_TRANSACTION",
          error: "Could not deserialize transaction",
          retryable: false,
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PAYMENT_REJECTED");
    });

    it("returns RELAY_ERROR when submitPayment is rejected without code", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: false,
          error: "unknown rejection reason",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("RELAY_ERROR");
      expect(result.error).toBe("unknown rejection reason");
    });

    it("uses default error message when submitPayment rejection has no error field", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: false,
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Payment submission rejected by relay");
    });

    it("passes txHex and settle as separate args to submitPayment", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-args-check",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-args-check",
          status: "confirmed",
          txid: "args-txid",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(rpc.submitPayment).toHaveBeenCalledWith(baseTxHex, baseSettle);
    });
  });

  describe("successful settlement paths", () => {
    it("returns success on confirmed payment with txid", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-001",
          status: "confirmed",
          txid: "abc123txid",
          blockHeight: 12345,
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("abc123txid");
      expect(result.paymentStatus).toBe("confirmed");
      expect(result.paymentId).toBe("pay-001");
      expect(rpc.checkPayment).toHaveBeenCalledWith("pay-001");
    });

    it("includes paymentId in success result", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-002",
          status: "confirmed",
          txid: "txid002",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentId).toBe("pay-002");
    });

    it("handles nonce gap warning (accepted=true with warning)", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-gap",
          status: "queued_with_warning",
          warning: {
            code: "SENDER_NONCE_GAP",
            detail: "nonce gap detected",
            senderNonce: { provided: 5, expected: 3, lastSeen: 2 },
            help: "https://...",
            action: "check nonce",
          },
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-gap",
          status: "confirmed",
          txid: "gap-txid",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Nonce gap is accepted — should proceed to polling and succeed
      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("gap-txid");
    });
  });

  describe("failed settlement from checkPayment", () => {
    it("returns failure when checkPayment returns status failed", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-fail-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-001",
          status: "failed",
          errorCode: "BROADCAST_FAILED",
          error: "tx rejected by mempool",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("BROADCAST_FAILED");
      expect(result.relayCode).toBe("BROADCAST_FAILED");
      expect(result.relayDetail).toBe("tx rejected by mempool");
    });

    it("returns RELAY_ERROR when checkPayment fails without errorCode", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-fail-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-002",
          status: "failed",
          error: "internal relay error",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("RELAY_ERROR");
    });

    it("uses default error message when failed check has no error field", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-fail-003",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-fail-003",
          status: "failed",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Payment failed");
    });

    it("returns failure when checkPayment returns replaced status", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-replaced",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-replaced",
          status: "replaced",
          error: "sponsor replaced transaction",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("sponsor replaced transaction");
    });

    it("returns failure when checkPayment returns not_found", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-notfound",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-notfound",
          status: "not_found",
          error: "Payment pay-notfound not found or expired",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("RELAY_ERROR");
    });
  });

  describe("poll exhaustion", () => {
    it("returns SETTLEMENT_TIMEOUT when all poll attempts return queued", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-exhaust-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-001",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(result.error).toContain("paymentTxid");
      expect(result.paymentId).toBe("pay-exhaust-001");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(12);
    });

    it("returns SETTLEMENT_TIMEOUT when all poll attempts return broadcasting", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-exhaust-002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-002",
          status: "broadcasting",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SETTLEMENT_TIMEOUT");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(12);
    });

    it("treats mempool exhaustion as pending success (tx was broadcast)", async () => {
      // When all polls return "mempool", the tx is broadcast but not yet confirmed.
      // This is treated as pending success — mirrors the HTTP path's "settlement.status === pending" handling.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-exhaust-txid",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-exhaust-txid",
          status: "mempool",
          txid: "broadcast-but-not-confirmed",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("broadcast-but-not-confirmed");
      expect(result.paymentStatus).toBe("pending");
      expect(result.paymentId).toBe("pay-exhaust-txid");
    });
  });

  describe("multi-poll — confirmed after several attempts", () => {
    it("succeeds after polling through queued, broadcasting, and mempool states", async () => {
      let callCount = 0;
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-multi-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return { paymentId: "pay-multi-001", status: "queued" };
          if (callCount === 2) return { paymentId: "pay-multi-001", status: "broadcasting" };
          if (callCount === 3) return { paymentId: "pay-multi-001", status: "mempool", txid: "multi-poll-txid" };
          return {
            paymentId: "pay-multi-001",
            status: "confirmed",
            txid: "multi-poll-txid",
            blockHeight: 99999,
          };
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("multi-poll-txid");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(4);
    });
  });

  describe("submitPayment throwing (RPC exception)", () => {
    it("re-throws when submitPayment rejects with an exception", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockRejectedValue(new Error("RPC connection refused")),
        checkPayment: vi.fn(),
      };

      await expect(submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger)).rejects.toThrow(
        "RPC connection refused"
      );
    });
  });

  describe("checkPayment throwing (RPC exception)", () => {
    it("re-throws when checkPayment rejects with an exception", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-throw-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockRejectedValue(new Error("RPC stream closed")),
      };

      const resultPromise = expect(
        submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger)
      ).rejects.toThrow("RPC stream closed");
      await vi.runAllTimersAsync();
      await resultPromise;
    });
  });

  describe("logging behavior", () => {
    it("logs debug on submit and on each poll check", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay-log-001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-001",
          status: "confirmed",
          txid: "log-txid",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: submitting payment",
        expect.objectContaining({ transaction: expect.stringContaining("...") })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: payment queued",
        expect.objectContaining({ paymentId: "pay-log-001" })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: checkPayment",
        expect.objectContaining({ attempt: 0, paymentId: "pay-log-001", status: "confirmed" })
      );
    });

    it("logs warn on submitPayment rejection", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: false,
          code: "SENDER_NONCE_STALE",
          error: "stale nonce",
        }),
        checkPayment: vi.fn(),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
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
          accepted: true,
          paymentId: "pay-log-exhaust",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay-log-exhaust",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "RPC: poll exhausted",
        expect.objectContaining({ paymentId: "pay-log-exhaust" })
      );
    });
  });
});
