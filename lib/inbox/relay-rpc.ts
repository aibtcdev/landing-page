/**
 * RPC helpers for the X402_RELAY service binding.
 *
 * Caller-facing relay contracts come from `@aibtc/tx-schemas`; this file
 * only adapts them into the inbox route's legacy success/error envelope.
 */

import {
  RpcCheckPaymentResultSchema,
  RpcSenderNonceInfoSchema,
  RpcSettleOptionsSchema,
  RpcSubmitPaymentResultSchema,
} from "@aibtc/tx-schemas/rpc";
import type { TerminalReason } from "@aibtc/tx-schemas/terminal-reasons";
import type { z } from "zod";
import type { Logger } from "../logging";
import type { SponsorStatusResult } from "../sponsor/types";
import type { InboxPaymentErrorCode, InboxPaymentVerification } from "./x402-verify";
import {
  collapseSubmittedStatus,
  selectCanonicalCheckStatusUrl,
} from "./payment-contract";
import {
  RPC_POLL_INTERVAL_MS,
  RPC_POLL_MAX_ATTEMPTS,
  RPC_TOTAL_TIMEOUT_MS,
} from "./constants";

export type RelaySettleOptions = z.infer<typeof RpcSettleOptionsSchema>;
export type RelaySenderNonceInfo = z.infer<typeof RpcSenderNonceInfoSchema>;
export type RelaySubmitResult = z.infer<typeof RpcSubmitPaymentResultSchema>;
export type RelayCheckResult = z.infer<typeof RpcCheckPaymentResultSchema>;

/**
 * Typed interface for the X402_RELAY service binding RPC methods.
 * Must match the actual relay WorkerEntrypoint method signatures.
 */
export interface RelayRPC {
  submitPayment(txHex: string, settle?: RelaySettleOptions): Promise<unknown>;
  checkPayment(paymentId: string): Promise<unknown>;
  getSponsorStatus?(): Promise<SponsorStatusResult>;
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
const PENDING_STATUSES = new Set(["queued", "broadcasting", "mempool"]);

const TERMINAL_REASON_ERROR_CODE_MAP: Partial<Record<TerminalReason, InboxPaymentErrorCode>> = {
  invalid_transaction: "PAYMENT_REJECTED",
  not_sponsored: "PAYMENT_REJECTED",
  sender_nonce_stale: "SENDER_NONCE_STALE",
  sender_nonce_gap: "SENDER_NONCE_GAP",
  sender_nonce_duplicate: "SENDER_NONCE_DUPLICATE",
  queue_unavailable: "RELAY_ERROR",
  sponsor_failure: "RELAY_ERROR",
  broadcast_failure: "BROADCAST_FAILED",
  chain_abort: "SETTLEMENT_FAILED",
  internal_error: "RELAY_ERROR",
};

function parseSubmitPaymentResult(raw: unknown): RelaySubmitResult {
  if (
    raw &&
    typeof raw === "object" &&
    "accepted" in raw &&
    (raw as { accepted?: unknown }).accepted === false &&
    !("error" in raw)
  ) {
    return RpcSubmitPaymentResultSchema.parse({
      ...raw,
      error: "Payment submission rejected by relay",
    });
  }

  return RpcSubmitPaymentResultSchema.parse(raw);
}

function parseCheckPaymentResult(raw: unknown): RelayCheckResult {
  return RpcCheckPaymentResultSchema.parse(collapseSubmittedStatus(raw));
}

function mapTerminalOutcome(
  checkResult: RelayCheckResult
): InboxPaymentErrorCode {
  if (checkResult.terminalReason) {
    return TERMINAL_REASON_ERROR_CODE_MAP[checkResult.terminalReason] ?? "RELAY_ERROR";
  }

  return mapRPCErrorCode(checkResult.errorCode);
}

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
  const submitResult = parseSubmitPaymentResult(await rpc.submitPayment(txHex, settle));

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

    const checkResult = parseCheckPaymentResult(await rpc.checkPayment(paymentId));
    lastCheckResult = checkResult;
    log.debug("RPC: checkPayment", { attempt, paymentId, status: checkResult.status });

    if (checkResult.status === "confirmed") {
      return {
        success: true,
        paymentTxid: checkResult.txid || "",
        paymentStatus: "confirmed",
        paymentId,
        ...(selectCanonicalCheckStatusUrl(checkResult.checkStatusUrl, submitResult.checkStatusUrl) && {
          checkStatusUrl: selectCanonicalCheckStatusUrl(
            checkResult.checkStatusUrl,
            submitResult.checkStatusUrl
          ),
        }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
      };
    }

    if (checkResult.status === "failed" || checkResult.status === "replaced") {
      const errorCode = mapTerminalOutcome(checkResult);
      log.warn("RPC: payment failed", {
        paymentId,
        status: checkResult.status,
        terminalReason: checkResult.terminalReason,
        errorCode: checkResult.errorCode,
        error: checkResult.error,
      });
      return {
        success: false,
        error: checkResult.error || `Payment ${checkResult.status}`,
        errorCode,
        paymentId,
        ...(selectCanonicalCheckStatusUrl(checkResult.checkStatusUrl, submitResult.checkStatusUrl) && {
          checkStatusUrl: selectCanonicalCheckStatusUrl(
            checkResult.checkStatusUrl,
            submitResult.checkStatusUrl
          ),
        }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
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
        ...(selectCanonicalCheckStatusUrl(checkResult.checkStatusUrl, submitResult.checkStatusUrl) && {
          checkStatusUrl: selectCanonicalCheckStatusUrl(
            checkResult.checkStatusUrl,
            submitResult.checkStatusUrl
          ),
        }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
      };
    }

    // status is "queued", "broadcasting", or "mempool" — keep polling
    if (!PENDING_STATUSES.has(checkResult.status)) {
      log.warn("RPC: unexpected status", { paymentId, status: checkResult.status });
    }
  }

  // Exhausted all poll attempts or hit total deadline.
  // The relay accepted the payment (accepted: true above), so it will process it.
  // If the last known status is still in-progress (or we never got a check response),
  // return pending success — the relay has it and will eventually settle.
  const lastStatus = lastCheckResult?.status;
  if (!lastStatus || PENDING_STATUSES.has(lastStatus)) {
    log.info("RPC: poll exhausted after relay accepted — treating as pending success", {
      paymentId,
      lastStatus: lastStatus ?? "none",
      ...(lastCheckResult?.txid && { txid: lastCheckResult.txid }),
    });
    return {
      success: true,
      paymentStatus: "pending",
      paymentId,
      ...(selectCanonicalCheckStatusUrl(lastCheckResult?.checkStatusUrl, submitResult.checkStatusUrl) && {
        checkStatusUrl: selectCanonicalCheckStatusUrl(
          lastCheckResult?.checkStatusUrl,
          submitResult.checkStatusUrl
        ),
      }),
      ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
    };
  }

  // Safety net: unexpected status at poll exhaustion (should not normally occur).
  log.warn("RPC: poll exhausted with unexpected status", {
    paymentId,
    lastStatus,
    attempts: RPC_POLL_MAX_ATTEMPTS,
  });
  return {
    success: false,
    error: "RPC poll timed out waiting for settlement. Recover via paymentTxid.",
    errorCode: "SETTLEMENT_TIMEOUT",
    paymentId,
    ...(selectCanonicalCheckStatusUrl(lastCheckResult?.checkStatusUrl, submitResult.checkStatusUrl) && {
      checkStatusUrl: selectCanonicalCheckStatusUrl(
        lastCheckResult?.checkStatusUrl,
        submitResult.checkStatusUrl
      ),
    }),
    ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
  };
}
