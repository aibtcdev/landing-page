/**
 * RPC type definitions and helpers for the X402_RELAY service binding.
 *
 * These interfaces match the RelayRPC WorkerEntrypoint exposed by the
 * x402-sponsor-relay worker (x402Stacks/x402-sponsor-relay).
 *
 * submitViaRPC() replaces the HTTP fetch path in verifyInboxPayment()
 * when a service binding is available, using submitPayment() + polling
 * checkPayment() to eliminate nonce contention from synchronous relay calls.
 */

import type { Logger } from "../logging";
import type { InboxPaymentErrorCode, InboxPaymentVerification } from "./x402-verify";
import {
  RPC_POLL_INTERVAL_MS,
  RPC_POLL_MAX_ATTEMPTS,
  RPC_TOTAL_TIMEOUT_MS,
} from "./constants";

/** Parameters for RelayRPC.submitPayment() */
export interface RelaySubmitParams {
  transaction: string;          // hex-serialized Stacks transaction
  maxTimeoutSeconds?: number;   // optional polling limit for the relay
  settle?: {
    expectedRecipient: string;
    minAmount: string;
    tokenType: string;
  };
}

/** Response from RelayRPC.submitPayment() */
export interface RelaySubmitResult {
  paymentId: string;
  status: "queued" | "rejected";
  error?: string;
  code?: string;               // e.g. SENDER_NONCE_STALE
  retryAfter?: number;
}

/** Response from RelayRPC.checkPayment() */
export interface RelayCheckResult {
  paymentId: string;
  status: "queued" | "processing" | "confirmed" | "failed" | "timeout";
  txid?: string;
  receiptId?: string;
  error?: string;
  code?: string;
  settlement?: {
    status: string;
    sender?: string;
    recipient?: string;
    amount?: string;
  };
}

/** Typed interface for the X402_RELAY service binding RPC methods. */
export interface RelayRPC {
  submitPayment(params: RelaySubmitParams): Promise<RelaySubmitResult>;
  checkPayment(paymentId: string): Promise<RelayCheckResult>;
}

/** Maps raw RPC relay error codes to typed InboxPaymentErrorCode values. */
const RPC_ERROR_CODE_MAP: Record<string, InboxPaymentErrorCode> = {
  // Pre-enqueue nonce rejections (SENDER_NONCE_*)
  SENDER_NONCE_STALE: "SENDER_NONCE_STALE",
  SENDER_NONCE_DUPLICATE: "SENDER_NONCE_DUPLICATE",
  SENDER_NONCE_GAP: "SENDER_NONCE_GAP",
  // Broadcast failures
  BROADCAST_FAILED: "BROADCAST_FAILED",
  TX_BROADCAST_ERROR: "BROADCAST_FAILED",
  // Settlement
  SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
  // Insufficient funds
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  BALANCE_ERROR: "INSUFFICIENT_FUNDS",
  // Nonce conflicts (retryable)
  NONCE_CONFLICT: "NONCE_CONFLICT",
  CLIENT_NONCE_CONFLICT: "NONCE_CONFLICT",
  CLIENT_BAD_NONCE: "NONCE_CONFLICT",
  TOO_MUCH_CHAINING: "NONCE_CONFLICT",
};

/**
 * Map an RPC relay error code to a typed InboxPaymentErrorCode.
 * Covers both pre-enqueue nonce rejections (SENDER_NONCE_*) and
 * post-broadcast settlement failures.
 */
export function mapRPCErrorCode(
  code: string | undefined
): InboxPaymentErrorCode {
  if (!code) return "RELAY_ERROR";
  return RPC_ERROR_CODE_MAP[code] ?? "RELAY_ERROR";
}

/**
 * Submit a sponsored payment via RPC service binding and poll for settlement.
 *
 * Calls submitPayment() to enqueue the transaction, then polls checkPayment()
 * at RPC_POLL_INTERVAL_MS intervals up to RPC_POLL_MAX_ATTEMPTS times.
 *
 * Throws on RPC call exceptions — the caller is responsible for catching
 * those and recording circuit breaker failures.
 *
 * @param rpc - The X402_RELAY service binding instance
 * @param params - Transaction params (transaction hex + settle constraints)
 * @param log - Logger instance for diagnostics
 * @returns InboxPaymentVerification with success/failure details
 */
export async function submitViaRPC(
  rpc: RelayRPC,
  params: RelaySubmitParams,
  log: Logger
): Promise<InboxPaymentVerification> {
  const deadline = Date.now() + RPC_TOTAL_TIMEOUT_MS;

  // Step 1: Submit the payment to the relay queue
  log.debug("RPC: submitting payment", { transaction: params.transaction.slice(0, 16) + "..." });
  const submitResult = await rpc.submitPayment(params);

  if (submitResult.status === "rejected") {
    const errorCode = mapRPCErrorCode(submitResult.code);
    log.warn("RPC: submitPayment rejected", {
      code: submitResult.code,
      errorCode,
      error: submitResult.error,
    });
    return {
      success: false,
      error: submitResult.error || "Payment submission rejected by relay",
      errorCode,
      ...(submitResult.code != null && { relayCode: submitResult.code }),
      ...(submitResult.error && { relayDetail: submitResult.error }),
      ...(submitResult.retryAfter != null && { retryAfterSeconds: submitResult.retryAfter }),
    };
  }

  const { paymentId } = submitResult;
  log.debug("RPC: payment queued", { paymentId });

  // Step 2: Poll for settlement result (bounded by both attempt count and total deadline)
  let lastCheckResult: RelayCheckResult | undefined;
  for (let attempt = 0; attempt < RPC_POLL_MAX_ATTEMPTS; attempt++) {
    if (Date.now() >= deadline) {
      log.warn("RPC: total timeout reached before poll", { paymentId, attempt });
      break;
    }

    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RPC_POLL_INTERVAL_MS));
    }

    const checkResult = await rpc.checkPayment(paymentId);
    lastCheckResult = checkResult;
    log.debug("RPC: checkPayment", { attempt, paymentId, status: checkResult.status });

    if (checkResult.status === "confirmed") {
      const isPending = checkResult.settlement?.status === "pending";
      const paymentStatus = isPending ? "pending" : "confirmed";
      return {
        success: true,
        payerStxAddress: checkResult.settlement?.sender || "",
        paymentTxid: checkResult.txid || "",
        paymentStatus,
        paymentId,
        ...(checkResult.receiptId && { receiptId: checkResult.receiptId }),
      };
    }

    if (checkResult.status === "failed") {
      const errorCode = mapRPCErrorCode(checkResult.code);
      log.warn("RPC: payment failed", {
        paymentId,
        code: checkResult.code,
        errorCode,
        error: checkResult.error,
      });
      return {
        success: false,
        error: checkResult.error || "Payment settlement failed",
        errorCode,
        paymentId,
        ...(checkResult.txid && { paymentTxid: checkResult.txid }),
        ...(checkResult.code != null && { relayCode: checkResult.code }),
        ...(checkResult.error && { relayDetail: checkResult.error }),
      };
    }

    if (checkResult.status === "timeout") {
      log.warn("RPC: relay timed out polling payment", { paymentId });
      return {
        success: false,
        error: "Relay timed out waiting for settlement. Recover via paymentTxid.",
        errorCode: "SETTLEMENT_TIMEOUT",
        paymentId,
        ...(checkResult.txid && { paymentTxid: checkResult.txid }),
        ...(checkResult.receiptId && { receiptId: checkResult.receiptId }),
      };
    }

    // status is "queued" or "processing" — keep polling
  }

  // Exhausted all poll attempts or hit total deadline
  log.warn("RPC: poll exhausted", { paymentId, attempts: RPC_POLL_MAX_ATTEMPTS });
  return {
    success: false,
    error: "RPC poll timed out waiting for settlement. Recover via paymentTxid.",
    errorCode: "SETTLEMENT_TIMEOUT",
    paymentId,
    ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
    ...(lastCheckResult?.receiptId && { receiptId: lastCheckResult.receiptId }),
  };
}
