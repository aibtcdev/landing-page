/**
 * RPC type definitions and helpers for the X402_RELAY service binding.
 *
 * These interfaces match the RelayRPC WorkerEntrypoint exposed by the
 * x402-sponsor-relay worker (x402Stacks/x402-sponsor-relay).
 * Source of truth: x402-sponsor-relay/src/rpc.ts
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

// ---------------------------------------------------------------------------
// Types matching x402-sponsor-relay/src/rpc.ts SubmitPaymentResult
// ---------------------------------------------------------------------------

/** Settlement options passed to submitPayment (mirrors relay SettleOptions). */
export interface RelaySettleOptions {
  expectedRecipient: string;
  minAmount: string;
  tokenType?: string;
  expectedSender?: string;
  maxTimeoutSeconds?: number;
}

/** Sender nonce health info returned by the relay. */
export interface RelaySenderNonceInfo {
  provided: number;
  expected: number;
  healthy: boolean;
  warning?: string;
}

/** Response from RelayRPC.submitPayment(). Mirrors SubmitPaymentResult. */
export interface RelaySubmitResult {
  accepted: boolean;
  paymentId?: string;
  status?: string;
  senderNonce?: RelaySenderNonceInfo;
  warning?: {
    code: string;
    detail: string;
    senderNonce: { provided: number; expected: number; lastSeen: number };
    help: string;
    action: string;
  };
  error?: string;
  code?: string;
  retryable?: boolean;
  help?: string;
  action?: string;
  checkStatusUrl?: string;
}

/** Response from RelayRPC.checkPayment(). Mirrors CheckPaymentResult. */
export interface RelayCheckResult {
  paymentId: string;
  status: string;
  txid?: string;
  blockHeight?: number;
  confirmedAt?: string;
  explorerUrl?: string;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  senderNonceInfo?: RelaySenderNonceInfo;
}

/**
 * Typed interface for the X402_RELAY service binding RPC methods.
 * Must match the actual relay WorkerEntrypoint method signatures.
 */
export interface RelayRPC {
  submitPayment(txHex: string, settle?: RelaySettleOptions): Promise<RelaySubmitResult>;
  checkPayment(paymentId: string): Promise<RelayCheckResult>;
}

/** Maps raw RPC relay error codes to typed InboxPaymentErrorCode values. */
const RPC_ERROR_CODE_MAP: Record<string, InboxPaymentErrorCode> = {
  // Pre-enqueue nonce rejections (SENDER_NONCE_*)
  SENDER_NONCE_STALE: "SENDER_NONCE_STALE",
  SENDER_NONCE_DUPLICATE: "SENDER_NONCE_DUPLICATE",
  SENDER_NONCE_GAP: "SENDER_NONCE_GAP",
  // Validation errors
  INVALID_TRANSACTION: "PAYMENT_REJECTED",
  NOT_SPONSORED: "PAYMENT_REJECTED",
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
  // Internal
  INTERNAL_ERROR: "RELAY_ERROR",
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

/** In-progress statuses where we keep polling. */
const PENDING_STATUSES = new Set(["queued", "submitted", "broadcasting", "mempool"]);

/**
 * Submit a sponsored payment via RPC service binding and poll for settlement.
 *
 * Calls submitPayment(txHex, settle) to enqueue the transaction, then polls
 * checkPayment() at RPC_POLL_INTERVAL_MS intervals up to RPC_POLL_MAX_ATTEMPTS
 * times or RPC_TOTAL_TIMEOUT_MS total.
 *
 * Throws on RPC call exceptions — the caller is responsible for catching
 * those and recording circuit breaker failures.
 */
export async function submitViaRPC(
  rpc: RelayRPC,
  txHex: string,
  settle: RelaySettleOptions | undefined,
  log: Logger
): Promise<InboxPaymentVerification> {
  const deadline = Date.now() + RPC_TOTAL_TIMEOUT_MS;

  // Step 1: Submit the payment to the relay queue
  log.debug("RPC: submitting payment", { transaction: txHex.slice(0, 16) + "..." });
  const submitResult = await rpc.submitPayment(txHex, settle);

  if (!submitResult.accepted) {
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
    };
  }

  const paymentId = submitResult.paymentId;
  if (!paymentId) {
    log.warn("RPC: submitPayment accepted but missing paymentId");
    return {
      success: false,
      error: "Relay accepted payment but did not return a paymentId",
      errorCode: "RELAY_ERROR",
    };
  }
  log.debug("RPC: payment queued", {
    paymentId,
    status: submitResult.status,
    ...(submitResult.warning && { warning: submitResult.warning.code }),
  });

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
      return {
        success: true,
        paymentTxid: checkResult.txid || "",
        paymentStatus: "confirmed",
        paymentId,
      };
    }

    if (checkResult.status === "failed" || checkResult.status === "replaced") {
      const errorCode = mapRPCErrorCode(checkResult.errorCode);
      log.warn("RPC: payment failed", {
        paymentId,
        status: checkResult.status,
        errorCode: checkResult.errorCode,
        error: checkResult.error,
      });
      return {
        success: false,
        error: checkResult.error || `Payment ${checkResult.status}`,
        errorCode,
        paymentId,
        ...(checkResult.txid && { paymentTxid: checkResult.txid }),
        ...(checkResult.errorCode != null && { relayCode: checkResult.errorCode }),
        ...(checkResult.error && { relayDetail: checkResult.error }),
      };
    }

    if (checkResult.status === "not_found") {
      log.warn("RPC: payment not found", { paymentId });
      return {
        success: false,
        error: "Payment not found in relay — it may have expired.",
        errorCode: "RELAY_ERROR",
        paymentId,
      };
    }

    // status is "queued", "submitted", "broadcasting", "mempool" — keep polling
    if (!PENDING_STATUSES.has(checkResult.status)) {
      log.warn("RPC: unexpected status", { paymentId, status: checkResult.status });
    }
  }

  // Exhausted all poll attempts or hit total deadline
  log.warn("RPC: poll exhausted", { paymentId, attempts: RPC_POLL_MAX_ATTEMPTS });
  return {
    success: false,
    error: "RPC poll timed out waiting for settlement. Recover via paymentTxid.",
    errorCode: "SETTLEMENT_TIMEOUT",
    paymentId,
    ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
  };
}
