import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testUtils, mapRPCErrorCode, submitViaRPC } from "../relay-rpc";
import type { RelayRPC, RelaySettleOptions } from "../relay-rpc";
import type { Logger } from "@/lib/logging";
import { TerminalReasonSchema } from "@aibtc/tx-schemas/terminal-reasons";
import { RpcErrorCodeSchema } from "@aibtc/tx-schemas/rpc";

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
          paymentId: "pay_args_check",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_args_check",
          status: "confirmed",
          txid: "a".repeat(64),
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(rpc.submitPayment).toHaveBeenCalledWith(baseTxHex, baseSettle);
    });

    it("fails closed when submitPayment accepts but omits canonical paymentId", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          status: "queued",
          checkStatusUrl: "https://relay.example/check/missing-id",
        }),
        checkPayment: vi.fn(),
      };

      const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("MISSING_CANONICAL_IDENTITY");
      expect(result.checkStatusUrl).toBe("https://relay.example/check/missing-id");
      expect(rpc.checkPayment).not.toHaveBeenCalled();
    });
  });

  describe("successful settlement paths", () => {
    it("returns success on confirmed payment with txid", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_001",
          status: "confirmed",
          txid: "a".repeat(64),
          blockHeight: 12345,
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("a".repeat(64));
      expect(result.paymentStatus).toBe("confirmed");
      expect(result.paymentId).toBe("pay_001");
      expect(rpc.checkPayment).toHaveBeenCalledWith("pay_001");
    });

    it("includes paymentId in success result", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_002",
          status: "confirmed",
          txid: "b".repeat(64),
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentId).toBe("pay_002");
    });

    it("prefers checkPayment checkStatusUrl over submitPayment hint", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_hint_preferred",
          status: "queued",
          checkStatusUrl: "https://relay.example/pay/pay_hint_preferred",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_hint_preferred",
          status: "confirmed",
          txid: "1".repeat(64),
          checkStatusUrl: "https://relay.example/check/pay_hint_preferred",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.checkStatusUrl).toBe("https://relay.example/check/pay_hint_preferred");
    });

    it("handles nonce gap warning (accepted=true with warning)", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_gap",
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
          paymentId: "pay_gap",
          status: "confirmed",
          txid: "c".repeat(64),
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Nonce gap is accepted — should proceed to polling and succeed
      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("c".repeat(64));
    });
  });

  describe("failed settlement from checkPayment", () => {
    it("returns failure when checkPayment returns status failed", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_fail_001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_fail_001",
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
          paymentId: "pay_fail_002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_fail_002",
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
          paymentId: "pay_fail_003",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_fail_003",
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
          paymentId: "pay_replaced",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_replaced",
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
          paymentId: "pay_notfound",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_notfound",
          status: "not_found",
          terminalReason: "unknown_payment_identity",
          checkStatusUrl: "https://relay.example/check/pay_notfound",
          errorCode: "UNKNOWN_PAYMENT_IDENTITY",
          error: "Payment pay_notfound not found or expired",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PAYMENT_NOT_FOUND");
      expect(result.terminalReason).toBe("unknown_payment_identity");
      expect(result.checkStatusUrl).toBe("https://relay.example/check/pay_notfound");
      expect(result.relayCode).toBe("UNKNOWN_PAYMENT_IDENTITY");
      expect(result.relayDetail).toBe("Payment pay_notfound not found or expired");
    });

    it("surfaces sender nonce gap terminal metadata from relay polling", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_gap_terminal",
          status: "queued",
          checkStatusUrl: "https://relay.example/pay/pay_gap_terminal",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_gap_terminal",
          status: "failed",
          terminalReason: "sender_nonce_gap",
          errorCode: "SENDER_NONCE_GAP",
          error: "sender nonce gap detected",
          checkStatusUrl: "https://relay.example/check/pay_gap_terminal",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SENDER_NONCE_GAP");
      expect(result.terminalReason).toBe("sender_nonce_gap");
      expect(result.checkStatusUrl).toBe("https://relay.example/check/pay_gap_terminal");
      expect(result.relayCode).toBe("SENDER_NONCE_GAP");
      expect(result.relayDetail).toBe("sender nonce gap detected");
    });
  });

  describe("poll exhaustion", () => {
    it("returns pending success when all poll attempts return queued", async () => {
      // queued is a PENDING_STATUS — poll exhaustion with pending status returns
      // { success: true, paymentStatus: "pending" } since Phase 1.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_exhaust_001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_exhaust_001",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe("pending");
      expect(result.paymentId).toBe("pay_exhaust_001");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(2);
    });

    it("falls back to submitPayment checkStatusUrl when polling result omits it", async () => {
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_submit_hint_only",
          status: "queued",
          checkStatusUrl: "https://relay.example/pay/pay_submit_hint_only",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_submit_hint_only",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe("pending");
      expect(result.checkStatusUrl).toBe("https://relay.example/pay/pay_submit_hint_only");
    });

    it("returns pending success when all poll attempts return broadcasting", async () => {
      // broadcasting is a PENDING_STATUS — poll exhaustion returns pending success.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_exhaust_002",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_exhaust_002",
          status: "broadcasting",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe("pending");
      expect(rpc.checkPayment).toHaveBeenCalledTimes(2);
    });

    it("treats mempool exhaustion as pending success (tx was broadcast)", async () => {
      // When all polls return "mempool", the tx is broadcast but not yet confirmed.
      // This is treated as pending success — mirrors the HTTP path's "settlement.status === pending" handling.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_exhaust_txid",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_exhaust_txid",
          status: "mempool",
          txid: "d".repeat(64),
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("d".repeat(64));
      expect(result.paymentStatus).toBe("pending");
      expect(result.paymentId).toBe("pay_exhaust_txid");
    });

    it("returns pending success when mempool status has no txid", async () => {
      // mempool is a PENDING_STATUS — poll exhaustion returns pending success.
      // paymentTxid is omitted when the relay has no txid yet.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_no_txid",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_no_txid",
          status: "mempool",
          // no txid yet
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe("pending");
      expect(result.paymentId).toBe("pay_no_txid");
      expect(result.paymentTxid).toBeUndefined();
    });
  });

  describe("multi-poll — confirmed after several attempts", () => {
    it("confirms on second poll (within 2-poll budget)", async () => {
      // With 2 max polls, confirm on attempt 2 — fast path succeeds.
      let callCount = 0;
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_multi_001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return { paymentId: "pay_multi_001", status: "queued" };
          return {
            paymentId: "pay_multi_001",
            status: "confirmed",
            txid: "e".repeat(64),
            blockHeight: 99999,
          };
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.paymentTxid).toBe("e".repeat(64));
      expect(rpc.checkPayment).toHaveBeenCalledTimes(2);
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
          paymentId: "pay_throw_001",
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
          paymentId: "pay_log_001",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_log_001",
          status: "confirmed",
          txid: "f".repeat(64),
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
        expect.objectContaining({ paymentId: "pay_log_001" })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "RPC: checkPayment",
        expect.objectContaining({ attempt: 0, paymentId: "pay_log_001", status: "confirmed" })
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

    it("logs info on poll exhaustion with pending success", async () => {
      // Since Phase 1, poll exhaustion with pending status logs info (not warn) and succeeds.
      const rpc: RelayRPC = {
        submitPayment: vi.fn().mockResolvedValue({
          accepted: true,
          paymentId: "pay_log_exhaust",
          status: "queued",
        }),
        checkPayment: vi.fn().mockResolvedValue({
          paymentId: "pay_log_exhaust",
          status: "queued",
        }),
      };

      const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        "RPC: poll exhausted after relay accepted — treating as pending success",
        expect.objectContaining({ paymentId: "pay_log_exhaust" })
      );
    });
  });
});

describe("tx-schemas 1.0.0 schema compatibility", () => {
  describe("new TerminalReason variants parse correctly", () => {
    const newFailedReasons = [
      "sponsor_exhausted",
      "sponsor_nonce_conflict",
      "origin_chaining_limit",
      "broadcast_rate_limited",
      "sender_hand_expired",
    ] as const;

    for (const reason of newFailedReasons) {
      it(`parses new failed terminal reason: ${reason}`, () => {
        expect(TerminalReasonSchema.parse(reason)).toBe(reason);
      });
    }
  });

  describe("new RpcErrorCode variants parse correctly", () => {
    const newRpcCodes = [
      "SPONSOR_EXHAUSTED",
      "ORIGIN_CHAINING_LIMIT",
      "BROADCAST_RATE_LIMITED",
      "SENDER_HAND_EXPIRED",
      "NONCE_OCCUPIED",
    ] as const;

    for (const code of newRpcCodes) {
      it(`parses new RPC error code: ${code}`, () => {
        expect(RpcErrorCodeSchema.parse(code)).toBe(code);
      });
    }
  });

  describe("new TerminalReason variants map to correct InboxPaymentErrorCode", () => {
    // Safety net: if an assertion throws mid-test, restore real timers so fake
    // timers don't leak into unrelated tests further down the file.
    afterEach(() => {
      vi.useRealTimers();
    });

    const newReasonMappings = [
      {
        reason: "sponsor_exhausted",
        expectedErrorCode: "INSUFFICIENT_FUNDS",
        paymentId: "pay_sponsor_exhausted",
        error: "sponsor wallet has no available capacity",
      },
      {
        reason: "sponsor_nonce_conflict",
        expectedErrorCode: "RELAY_ERROR",
        paymentId: "pay_sponsor_nonce_conflict",
        error: "sponsor nonce conflicted with an in-flight tx",
      },
      {
        reason: "origin_chaining_limit",
        expectedErrorCode: "NONCE_CONFLICT",
        paymentId: "pay_chaining_limit",
        error: "sender exceeded chaining limit",
      },
      {
        reason: "broadcast_rate_limited",
        expectedErrorCode: "BROADCAST_FAILED",
        paymentId: "pay_broadcast_rate_limited",
        error: "broadcast rate limit exceeded",
      },
      {
        reason: "sender_hand_expired",
        expectedErrorCode: "PAYMENT_NOT_FOUND",
        paymentId: "pay_hand_expired",
        error: "sender hand TTL expired before dispatch",
      },
    ] as const;

    for (const { reason, expectedErrorCode, paymentId, error } of newReasonMappings) {
      it(`maps ${reason} checkPayment to ${expectedErrorCode}`, async () => {
        vi.useFakeTimers();

        const rpc: RelayRPC = {
          submitPayment: vi.fn().mockResolvedValue({
            accepted: true,
            paymentId,
            status: "queued",
          }),
          checkPayment: vi.fn().mockResolvedValue({
            paymentId,
            status: "failed",
            terminalReason: reason,
            error,
          }),
        };

        const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe(expectedErrorCode);
        expect(result.terminalReason).toBe(reason);
      });
    }
  });

  describe("new RpcErrorCode variants map to correct InboxPaymentErrorCode", () => {
    it("maps SPONSOR_EXHAUSTED to INSUFFICIENT_FUNDS", () => {
      expect(mapRPCErrorCode("SPONSOR_EXHAUSTED")).toBe("INSUFFICIENT_FUNDS");
    });

    it("maps ORIGIN_CHAINING_LIMIT to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("ORIGIN_CHAINING_LIMIT")).toBe("NONCE_CONFLICT");
    });

    it("maps BROADCAST_RATE_LIMITED to BROADCAST_FAILED", () => {
      expect(mapRPCErrorCode("BROADCAST_RATE_LIMITED")).toBe("BROADCAST_FAILED");
    });

    it("maps SENDER_HAND_EXPIRED to PAYMENT_NOT_FOUND", () => {
      expect(mapRPCErrorCode("SENDER_HAND_EXPIRED")).toBe("PAYMENT_NOT_FOUND");
    });

    it("maps NONCE_OCCUPIED to NONCE_CONFLICT", () => {
      expect(mapRPCErrorCode("NONCE_OCCUPIED")).toBe("NONCE_CONFLICT");
    });
  });
});

describe("relay-rpc parser compatibility", () => {
  it("drops unknown relay errorCode values while preserving canonical not_found fields", () => {
    const parsed = __testUtils.parseCheckPaymentResult({
      paymentId: "pay_parse_not_found",
      status: "not_found",
      terminalReason: "unknown_payment_identity",
      errorCode: "UNKNOWN_PAYMENT_IDENTITY",
      error: "Payment pay_parse_not_found not found or expired",
      checkStatusUrl: "https://relay.example/check/pay_parse_not_found",
    });

    expect(parsed).toEqual({
      paymentId: "pay_parse_not_found",
      status: "not_found",
      terminalReason: "unknown_payment_identity",
      error: "Payment pay_parse_not_found not found or expired",
      checkStatusUrl: "https://relay.example/check/pay_parse_not_found",
    });
  });
  it("preserves raw unknown relay errorCode for diagnostics", async () => {
    vi.useFakeTimers();

    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: true,
        paymentId: "pay_unknown_code",
        status: "queued",
      }),
      checkPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_unknown_code",
        status: "failed",
        errorCode: "FUTURE_RELAY_CODE",
        error: "future relay diagnostic",
      }),
    };

    const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("RELAY_ERROR");
    expect(result.relayCode).toBe("FUTURE_RELAY_CODE");
    expect(result.relayDetail).toBe("future relay diagnostic");

    vi.useRealTimers();
  });
});
