/**
 * x402 Payment Verification for Inbox Messages
 *
 * Verifies sBTC payments sent directly to recipient agents via x402 protocol.
 * Handles both sponsored and non-sponsored transactions.
 *
 * Key difference from x402-api middleware:
 * - Dynamic payTo: recipient agent's STX address (not a single platform address)
 * - Next.js-compatible: no Hono middleware, direct function calls
 * - sBTC-only: rejects STX and USDCx payments
 */

import {
  X402PaymentVerifier,
  networkToCAIP2,
  X402_ERROR_CODES,
} from "x402-stacks";
import type {
  PaymentPayloadV2,
  SettlementResponseV2,
  PaymentRequirementsV2,
} from "x402-stacks";
import { deserializeTransaction, AuthType, StacksWireType, addressToString, addressHashModeToVersion, type StacksTransactionWire } from "@stacks/transactions";
import {
  buildInboxPaymentRequirements,
  getSBTCAsset,
  DEFAULT_RELAY_URL,
} from "./x402-config";
import {
  getPaymentRepoVersion,
  logPaymentEvent,
} from "./payment-logging";
import {
  INBOX_PRICE_SATS,
  RELAY_SETTLE_TIMEOUT_MS,
  SBTC_CONTRACTS,
  RELAY_CIRCUIT_BREAKER_KEY,
  RELAY_CIRCUIT_BREAKER_THRESHOLD,
  RELAY_CIRCUIT_BREAKER_TTL_SECONDS,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS,
  PAYMENT_FAILURE_CACHE_TTL_SECONDS,
  CACHEABLE_PAYMENT_FAILURE_CODES,
} from "./constants";
import { getCachedPaymentFailure, cachePaymentFailure } from "./payment-cache";
import type { RelayPaymentStatus } from "./types";
import {
  checkCircuitBreaker,
  recordRelayFailure,
  resetCircuitBreaker,
} from "./circuit-breaker";
import type { RelayRPC } from "./relay-rpc";
import { submitViaRPC } from "./relay-rpc";
import type { Logger } from "../logging";
import { stacksApiFetch, buildHiroHeaders, parseRetryAfterMs } from "../stacks-api-fetch";
import { getCachedTransaction, setCachedTransaction } from "../identity/kv-cache";
import { STACKS_API_BASE, STACKS_API_TESTNET_BASE } from "../identity/constants";
import type { TerminalReason } from "@aibtc/tx-schemas/terminal-reasons";

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Subset of Stacks API transaction response used for sBTC transfer validation. */
interface StacksTxData {
  tx_id: string;
  tx_status: string;
  sender_address: string;
  tx_type: string;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: Array<{
      name: string;
      type: string;
      repr: string;
    }>;
  };
}

/**
 * Typed error codes for x402 inbox payment failures.
 *
 * - NONCE_CONFLICT: wallet nonce race; same tx hex is idempotent within 5 min — retry immediately.
 * - BROADCAST_FAILED: relay could not submit tx to the network; funds safe, retry with new payment.
 * - SETTLEMENT_FAILED: tx was broadcast but aborted on-chain (e.g. post-condition failure); not retryable as-is.
 * - SETTLEMENT_TIMEOUT: relay gave up polling but tx was broadcast; recover via paymentTxid.
 * - INSUFFICIENT_FUNDS: sBTC balance too low.
 * - PAYMENT_REJECTED: relay or verifier rejected the payment (bad payload, wrong recipient, etc.).
 * - PAYMENT_NOT_FOUND: relay reported the old canonical payment identity is gone.
 * - MISSING_CANONICAL_IDENTITY: relay accepted the payment but failed to return a canonical public identity.
 * - RELAY_ERROR: relay 5xx or unexpected failure.
 * - INVALID_TRANSACTION_FORMAT: payload contains invalid data (e.g. raw hex instead of serialized Stacks tx).
 * - SENDER_NONCE_STALE: RPC path — submitted nonce is below the current account nonce (pre-enqueue rejection).
 * - SENDER_NONCE_DUPLICATE: RPC path — a transaction with this nonce is already queued (pre-enqueue rejection).
 * - SENDER_NONCE_GAP: RPC path — submitted nonce creates a gap above the current account nonce (pre-enqueue rejection).
 */
export type InboxPaymentErrorCode =
  | "NONCE_CONFLICT"
  | "BROADCAST_FAILED"
  | "SETTLEMENT_FAILED"
  | "SETTLEMENT_TIMEOUT"
  | "INSUFFICIENT_FUNDS"
  | "PAYMENT_REJECTED"
  | "PAYMENT_NOT_FOUND"
  | "MISSING_CANONICAL_IDENTITY"
  | "RELAY_ERROR"
  | "INVALID_TRANSACTION_FORMAT"
  | "SENDER_NONCE_STALE"
  | "SENDER_NONCE_DUPLICATE"
  | "SENDER_NONCE_GAP";

/**
 * Error codes used by the txid recovery path (verifyTxidPayment).
 * These are distinct from relay settlement errors.
 */
export type TxidPaymentErrorCode =
  | "TXID_NOT_FOUND"
  | "API_ERROR"
  | "RATE_LIMITED"
  | "TX_NOT_CONFIRMED"
  | "INVALID_TX_TYPE"
  | "NOT_SBTC_TRANSFER"
  | "INVALID_TX_ARGS"
  | "INSUFFICIENT_AMOUNT"
  | "RECIPIENT_MISMATCH";

/**
 * Result of x402 payment verification for inbox messages.
 */
export interface InboxPaymentVerification {
  success: boolean;
  payerStxAddress?: string;
  paymentTxid?: string;
  /** @deprecated Message IDs are now always generated server-side in the route handler. */
  messageId?: string;
  error?: string;
  errorCode?: InboxPaymentErrorCode | TxidPaymentErrorCode | (string & {});
  /** Raw error code returned by the relay, for agent diagnostics. */
  relayCode?: string;
  /** Raw error detail or message from the relay, for agent diagnostics. */
  relayDetail?: string;
  /** Canonical terminal reason from the relay when the terminal outcome is known. */
  terminalReason?: TerminalReason;
  /** Canonical polling hint from the relay when it exposes one. */
  checkStatusUrl?: string;
  settleResult?: SettlementResponseV2;
  /** Compatibility status for inbox callers: confirmed is deliverable, pending means staged only. */
  paymentStatus?: RelayPaymentStatus;
  /** Legacy relay receipt identifier from the HTTP fallback path. */
  receiptId?: string;
  /** Seconds to wait before retrying (only set for retryable errors like NONCE_CONFLICT). */
  retryAfterSeconds?: number;
  /** RPC payment ID for continued polling or log correlation. */
  paymentId?: string;
}

/**
 * Extract a structured relay error code and retryAfter from an exception string.
 * Relay errors often embed JSON like: {"code":"BROADCAST_FAILED","retryAfter":5}
 */
function parseRelayException(error: unknown): {
  errorStr: string;
  embeddedCode: string | undefined;
  embeddedRetryAfter: number | undefined;
} {
  const errorStr = String(error);
  let embeddedCode: string | undefined;
  let embeddedRetryAfter: number | undefined;
  try {
    const jsonMatch = errorStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { code?: string; retryAfter?: number };
      embeddedCode = parsed.code;
      embeddedRetryAfter = parsed.retryAfter;
    }
  } catch { /* ignore parse failure */ }
  return { errorStr, embeddedCode, embeddedRetryAfter };
}

/**
 * Build a failed InboxPaymentVerification from a relay exception.
 * Shared by both sponsored and non-sponsored settlement catch blocks.
 */
function relayExceptionResult(
  errorPrefix: string,
  error: unknown
): InboxPaymentVerification {
  const { errorStr, embeddedCode, embeddedRetryAfter } = parseRelayException(error);
  const mappedCode = mapRelayErrorCode(embeddedCode, 500);
  return {
    success: false,
    error: `${errorPrefix}: ${errorStr}`,
    errorCode: mappedCode,
    ...(embeddedCode != null && { relayCode: embeddedCode }),
    ...(errorStr && { relayDetail: errorStr }),
    ...(embeddedRetryAfter != null && { retryAfterSeconds: embeddedRetryAfter }),
  };
}

/**
 * Check whether an error is a DOMException timeout (AbortSignal.timeout() or
 * RPC service-binding timeout).  Timeouts indicate a slow relay, not a relay
 * outage, so they must NOT trip the circuit breaker.
 */
export function isRelayTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/**
 * Shared catch-block handler for relay exceptions (RPC and HTTP paths).
 *
 * - Timeouts return SETTLEMENT_TIMEOUT without tripping the circuit breaker.
 * - All other exceptions record a circuit breaker failure and return the
 *   parsed relay error.
 */
async function handleRelayException(
  label: string,
  error: unknown,
  log: Logger,
  kv: KVNamespace | undefined
): Promise<InboxPaymentVerification> {
  if (isRelayTimeout(error)) {
    log.warn(`${label} timeout (queue backpressure) — not counting as relay failure`);
    return {
      success: false,
      error: "Relay timed out (queue backpressure). Recover via paymentTxid if sBTC was broadcast.",
      errorCode: "SETTLEMENT_TIMEOUT",
    };
  }

  const result = relayExceptionResult(`${label} error`, error);
  log.error(`${label} exception`, {
    error: result.error,
    relayCode: result.relayCode,
    errorCode: result.errorCode,
  });
  if (kv) {
    await recordRelayFailure(
      kv,
      RELAY_CIRCUIT_BREAKER_KEY,
      RELAY_CIRCUIT_BREAKER_THRESHOLD,
      RELAY_CIRCUIT_BREAKER_TTL_SECONDS
    );
  }
  return result;
}

/** Relay error codes that warrant a single retry with backoff (relay is idempotent within 5 min). */
const RELAY_RETRYABLE_CODES = new Set([
  "NONCE_CONFLICT",
  "CLIENT_NONCE_CONFLICT",
  "CLIENT_BAD_NONCE",
  "TOO_MUCH_CHAINING",
]);

function shouldCountRelayFailureForBreaker(errorCode: InboxPaymentErrorCode | TxidPaymentErrorCode | (string & {}) | undefined): boolean {
  return errorCode === "RELAY_ERROR" || errorCode === "MISSING_CANONICAL_IDENTITY";
}

/** Parse a relay error response body into a structured object. */
function parseRelayErrorBody(
  body: string
): { code?: string; retryable?: boolean; retryAfter?: number } {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

/** Build a failed InboxPaymentVerification from a relay HTTP error response. */
function buildRelayErrorResult(
  errorBody: string,
  httpStatus: number,
  log: Logger
): InboxPaymentVerification {
  const parsed = parseRelayErrorBody(errorBody);
  const mappedCode = mapRelayErrorCode(parsed.code, httpStatus);
  log.error("Sponsor relay failed", {
    status: httpStatus,
    code: parsed.code,
    mappedCode,
    error: errorBody,
  });
  return {
    success: false,
    error: errorBody,
    errorCode: mappedCode,
    ...(parsed.code != null && { relayCode: parsed.code }),
    ...(errorBody && { relayDetail: errorBody }),
    ...(parsed.retryAfter != null && { retryAfterSeconds: parsed.retryAfter }),
  };
}

/**
 * Map a relay error code to a typed InboxPaymentErrorCode.
 * Used by both sponsored and non-sponsored settlement paths.
 */
function mapRelayErrorCode(
  relayCode: string | undefined,
  httpStatus: number
): InboxPaymentErrorCode {
  if (!relayCode) {
    return httpStatus >= 500 ? "RELAY_ERROR" : "PAYMENT_REJECTED";
  }
  if (RELAY_RETRYABLE_CODES.has(relayCode)) return "NONCE_CONFLICT";
  if (relayCode === "BROADCAST_FAILED" || relayCode === "TX_BROADCAST_ERROR") return "BROADCAST_FAILED";
  if (relayCode === "SETTLEMENT_TIMEOUT" || relayCode === "POLL_TIMEOUT") return "SETTLEMENT_TIMEOUT";
  if (relayCode === "INSUFFICIENT_FUNDS" || relayCode === "BALANCE_ERROR") return "INSUFFICIENT_FUNDS";
  if (relayCode === "SETTLEMENT_FAILED") return "SETTLEMENT_FAILED";
  if (httpStatus >= 500) return "RELAY_ERROR";
  return "PAYMENT_REJECTED";
}

/**
 * Verify x402 sBTC payment for an inbox message.
 *
 * Validates sBTC-only payment, minimum amount, and correct recipient.
 * Routes sponsored transactions through the relay; non-sponsored through
 * x402 verifier settle flow.
 */
export async function verifyInboxPayment(
  paymentPayload: PaymentPayloadV2,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  relayUrl: string = DEFAULT_RELAY_URL,
  logger?: Logger,
  kv?: KVNamespace,
  relayRPC?: RelayRPC,
  observability?: { route: string; repoVersion?: string; env?: Record<string, unknown> }
): Promise<InboxPaymentVerification> {
  const log = logger || NOOP_LOGGER;
  const repoVersion =
    observability?.repoVersion ?? getPaymentRepoVersion(observability?.env);

  const emitPaymentEvent = (
    level: "debug" | "info" | "warn" | "error",
    event:
      | "payment.accepted"
      | "payment.retry_decision"
      | "payment.fallback_used",
    metadata: Omit<Parameters<typeof logPaymentEvent>[4], "route">
  ) => {
    if (!observability) return;
    logPaymentEvent(log, level, event, repoVersion, {
      route: observability.route,
      ...metadata,
    });
  };

  // Helper: cache a payment failure before returning the result.
  // Consolidates the cache-write logic that was previously scattered across
  // 5 separate error paths (RPC, HTTP sponsored retry, HTTP sponsored direct,
  // HTTP structured failure, non-sponsored exception).
  let resolvedSenderStxAddress: string | undefined;
  async function returnWithCacheCheck(
    result: InboxPaymentVerification
  ): Promise<InboxPaymentVerification> {
    if (
      kv &&
      resolvedSenderStxAddress &&
      !result.success &&
      result.errorCode &&
      CACHEABLE_PAYMENT_FAILURE_CODES.has(result.errorCode)
    ) {
      await cachePaymentFailure(kv, resolvedSenderStxAddress, result.errorCode);
    }
    return result;
  }

  // Check circuit breaker before attempting any relay call.
  // When open, return 503-equivalent immediately to shed load.
  if (kv) {
    const cbState = await checkCircuitBreaker(kv, RELAY_CIRCUIT_BREAKER_KEY);
    if (cbState.open) {
      log.warn("Relay circuit breaker open — blocking request", {
        openedAt: cbState.openedAt,
        retryAfterSeconds: RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS,
      });
      return {
        success: false,
        error: "Relay is temporarily unavailable. Please retry shortly.",
        errorCode: "RELAY_ERROR",
        retryAfterSeconds: RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS,
      };
    }
  }

  // Validate network and asset
  const networkCAIP2 = networkToCAIP2(network);
  const expectedAsset = getSBTCAsset(network);

  // Build payment requirements with dynamic payTo
  const paymentRequirements: PaymentRequirementsV2 = buildInboxPaymentRequirements(
    recipientStxAddress,
    network,
    networkCAIP2
  );

  log.debug("Verifying inbox payment", {
    recipientStxAddress,
    expectedAsset,
    network: networkCAIP2,
    minAmount: paymentRequirements.amount,
  });

  // Check if payment is in sBTC (v2: check accepted.asset and payload.transaction)
  if (
    !paymentPayload.payload?.transaction ||
    paymentPayload.accepted.asset !== expectedAsset
  ) {
    log.warn("Payment rejected: not sBTC", {
      acceptedAsset: paymentPayload.accepted.asset,
      expectedAsset,
    });
    return {
      success: false,
      error: "Inbox messages require sBTC payment",
      errorCode: X402_ERROR_CODES.INVALID_PAYLOAD,
    };
  }

  // Message IDs are generated server-side in the route handler (not here).
  // paymentPayload.resource.url is the endpoint URL, not a message ID.

  // Determine if transaction is sponsored using stacks.js deserialization
  const txHex = paymentPayload.payload.transaction;
  let tx: StacksTransactionWire;
  try {
    tx = deserializeTransaction(txHex);
  } catch (error) {
    const errMsg = String(error);
    log.warn("Failed to deserialize transaction", { error: errMsg });
    return {
      success: false,
      error: "Invalid payment transaction format",
      errorCode: "INVALID_TRANSACTION_FORMAT",
    };
  }
  const isSponsored = tx.auth.authType === AuthType.Sponsored;

  // Extract sender STX address from the origin's spending condition
  // (works for both standard and sponsored auth types).
  const sc = tx.auth.spendingCondition;
  const senderVersion = addressHashModeToVersion(sc.hashMode, network);
  const senderStxAddress = addressToString({
    type: StacksWireType.Address,
    version: senderVersion,
    hash160: sc.signer,
  });
  resolvedSenderStxAddress = senderStxAddress;

  // Check per-sender payment failure cache before hitting the relay.
  // When a sender's wallet had insufficient funds recently, skip the relay and
  // return the cached error immediately with Retry-After guidance.
  if (kv) {
    const cached = await getCachedPaymentFailure(kv, senderStxAddress);
    if (cached) {
      log.warn("Payment failure cache hit — skipping relay", {
        senderStxAddress,
        errorCode: cached.errorCode,
        cachedAt: cached.cachedAt,
      });
      // Compute remaining TTL so Retry-After reflects actual cache window left
      const elapsedSeconds = Math.floor(
        (Date.now() - new Date(cached.cachedAt).getTime()) / 1000
      );
      const remainingSeconds = Math.max(
        1,
        PAYMENT_FAILURE_CACHE_TTL_SECONDS - elapsedSeconds
      );
      return {
        success: false,
        error:
          "Payment rejected: insufficient sBTC balance (cached). Please add sBTC to your wallet before retrying.",
        errorCode: cached.errorCode,
        retryAfterSeconds: remainingSeconds,
      };
    }
  }

  // Route all transactions through the relay (sponsored and non-sponsored)
  let settleResult: SettlementResponseV2;
  // Relay-specific fields populated only for sponsored transactions.
  let relayPaymentStatus: RelayPaymentStatus | undefined;
  let relayReceiptId: string | undefined;
  let relayPaymentId: string | undefined;
  let relayCheckStatusUrl: string | undefined;
  let relayTerminalReason: TerminalReason | undefined;

  if (isSponsored) {
    log.debug("Routing sponsored transaction to relay", {
      relayUrl,
      viaRPC: !!relayRPC,
    });

    // --- RPC path: use service binding when available ---
    if (relayRPC) {
      const settle = {
        expectedRecipient: recipientStxAddress,
        minAmount: paymentRequirements.amount,
        tokenType: "sBTC",
      };

      try {
        const rpcResult = await submitViaRPC(relayRPC, txHex, settle, log);

        // RPC failure: record circuit breaker for error codes counted by
        // shouldCountRelayFailureForBreaker(), cache for INSUFFICIENT_FUNDS,
        // then return.
        if (!rpcResult.success) {
          if (kv && shouldCountRelayFailureForBreaker(rpcResult.errorCode)) {
            await recordRelayFailure(
              kv,
              RELAY_CIRCUIT_BREAKER_KEY,
              RELAY_CIRCUIT_BREAKER_THRESHOLD,
              RELAY_CIRCUIT_BREAKER_TTL_SECONDS
            );
          }
          return returnWithCacheCheck(rpcResult);
        }

        // RPC success: translate result into settleResult for the shared success path.
        // checkPayment() doesn't return sender address — senderStxAddress was already
        // derived from the tx origin above (before the cache check).
        const senderAddress = senderStxAddress;
        settleResult = {
          success: true,
          transaction: rpcResult.paymentTxid ?? "",
          payer: senderAddress,
          network: networkCAIP2,
        };
        relayPaymentStatus = rpcResult.paymentStatus;
        relayPaymentId = rpcResult.paymentId;
        relayCheckStatusUrl = rpcResult.checkStatusUrl;
        relayTerminalReason = rpcResult.terminalReason;
      } catch (error) {
        return handleRelayException("RPC relay", error, log, kv);
      }
    } else {
      // --- HTTP fallback path: original fetch() logic ---
      emitPaymentEvent("warn", "payment.fallback_used", {
        action: "http_relay_fallback",
        status: "fallback",
      });

      const relayBody = JSON.stringify({
        transaction: paymentPayload.payload.transaction,
        // 10s relay poll + ~2.5s overhead + ~0.5s RTT ≈ 13s actual vs 20s AbortSignal = 7s margin
        maxTimeoutSeconds: 10,
        settle: {
          expectedRecipient: recipientStxAddress,
          minAmount: paymentRequirements.amount,
          tokenType: "sBTC",
        },
      });

      /** Perform one relay call and return the Response. */
      const callRelay = () =>
        fetch(`${relayUrl}/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: relayBody,
          signal: AbortSignal.timeout(RELAY_SETTLE_TIMEOUT_MS),
        });

      try {
        let relayResponse = await callRelay();

        // Handle retryable relay errors (e.g. NONCE_CONFLICT, TOO_MUCH_CHAINING) with optional backoff.
        // The relay is idempotent for the same tx hex within 5 minutes.
        // When relay provides retryAfter, we sleep up to 15s before retrying to stay
        // within the 20s AbortSignal budget. If retryAfter >= 15s, we skip the retry
        // and propagate the error so the client can honour the full backoff.
        // HTTP 409 = nonce conflict, HTTP 429 = chaining limit (TOO_MUCH_CHAINING).
        if (!relayResponse.ok && (relayResponse.status === 409 || relayResponse.status === 429)) {
          const errorBody = await relayResponse.text();
          const relayError = parseRelayErrorBody(errorBody);
          let didRetry = false;

          if (relayError.retryable && RELAY_RETRYABLE_CODES.has(relayError.code ?? "")) {
            const waitMs = Math.min((relayError.retryAfter ?? 0) * 1000, 15_000);
            if (waitMs >= 15_000) {
              emitPaymentEvent("warn", "payment.retry_decision", {
                status: relayError.code ?? null,
                action: "skip_retry_due_to_backoff_budget",
                additionalContext: {
                  retryAfterSeconds: relayError.retryAfter ?? null,
                  waitMs,
                },
              });
              log.warn("Relay retryAfter >= 15s — skipping retry to avoid timeout", {
                code: relayError.code,
                retryAfter: relayError.retryAfter,
              });
              // Fall through to the non-ok handler below with the original errorBody
            } else {
              emitPaymentEvent("info", "payment.retry_decision", {
                status: relayError.code ?? null,
                action: waitMs > 0 ? "retry_after_backoff" : "retry_immediately",
                additionalContext: {
                  retryAfterSeconds: relayError.retryAfter ?? null,
                  waitMs,
                },
              });
              if (waitMs > 0) {
                log.warn("Relay returned retryable nonce error, waiting before retry", {
                  code: relayError.code,
                  retryAfter: relayError.retryAfter,
                  waitMs,
                });
                await new Promise((r) => setTimeout(r, waitMs));
              } else {
                log.warn("Relay returned retryable nonce error, retrying immediately (idempotent tx hex)", {
                  code: relayError.code,
                });
              }
              relayResponse = await callRelay();
              didRetry = true;
            }
          }

          // If still not ok after retry (or was non-retryable / retry skipped), return structured error.
          if (!relayResponse.ok) {
            // After a successful retry call, read the new response body.
            // Otherwise reuse the already-consumed original errorBody to avoid bodyUsed errors.
            const finalErrorBody = didRetry
              ? await relayResponse.text()
              : errorBody;
            const errorResult = buildRelayErrorResult(finalErrorBody, relayResponse.status, log);
            return returnWithCacheCheck(errorResult);
          }
        } else if (!relayResponse.ok) {
          const errorText = await relayResponse.text();
          // Record 5xx relay failures toward the circuit breaker threshold.
          if (kv && relayResponse.status >= 500) {
            await recordRelayFailure(
              kv,
              RELAY_CIRCUIT_BREAKER_KEY,
              RELAY_CIRCUIT_BREAKER_THRESHOLD,
              RELAY_CIRCUIT_BREAKER_TTL_SECONDS
            );
          }
          const errorResult = buildRelayErrorResult(errorText, relayResponse.status, log);
          return returnWithCacheCheck(errorResult);
        }

        // Map relay response to SettlementResponseV2 format.
        // Relay returns {success, txid, receiptId, settlement: {status, sender, recipient, amount, ...}}
        // settlement.status can be "confirmed" or "pending" (pending = relay timed out, tx was broadcast).
        // SettlementResponseV2 expects {success, transaction, payer, network}.
        const relayData = (await relayResponse.json()) as {
          success: boolean;
          txid?: string;
          receiptId?: string;
          code?: string;
          terminalReason?: TerminalReason;
          error?: string;
          retryAfter?: number;
          details?: string;
          settlement?: { status?: string; sender?: string; recipient?: string; amount?: string };
        };

        // Handle structured failure returned with HTTP 200 (e.g. {success:false, code:"SETTLEMENT_FAILED"}).
        // Only pass through if not a "pending" settlement (pending is treated as success above).
        if (!relayData.success && relayData.settlement?.status !== "pending" && relayData.code) {
          const mappedCode = mapRelayErrorCode(relayData.code, 200);
          log.error("Relay returned structured failure", {
            code: relayData.code,
            details: relayData.details,
            mappedCode,
            error: relayData.error,
          });
          return returnWithCacheCheck({
            success: false,
            error: relayData.error || "Relay settlement failed",
            errorCode: mappedCode,
            ...(relayData.terminalReason && { terminalReason: relayData.terminalReason }),
            relayCode: relayData.code,
            ...((relayData.details || relayData.error) && { relayDetail: relayData.details || relayData.error }),
            ...(relayData.retryAfter != null && { retryAfterSeconds: relayData.retryAfter }),
          });
        }

        // Treat "pending" as success — the tx was broadcast even if settlement hasn't confirmed.
        // The relay can return success:false + settlement.status:"pending" when the poll times out
        // but the tx was broadcast. In that case, we still consider it a success with pending status.
        const isPending = relayData.settlement?.status === "pending";
        const relaySuccess = relayData.success === true || isPending;
        relayPaymentStatus = isPending ? "pending" : "confirmed";
        relayReceiptId = relayData.receiptId;

        settleResult = {
          success: relaySuccess,
          transaction: relayData.txid || "",
          payer: relayData.settlement?.sender || "",
          network: networkCAIP2,
        };
        log.debug("Sponsor relay result", { relayData, settleResult, relayPaymentStatus });
      } catch (error) {
        return handleRelayException("Sponsor relay", error, log, kv);
      }
    }
  } else {
    log.debug("Settling non-sponsored transaction via relay", {
      relayUrl,
    });

    const verifier = new X402PaymentVerifier(relayUrl);

    try {
      settleResult = await verifier.settle(paymentPayload, {
        paymentRequirements,
      });
      log.debug("Relay settle result", { settleResult });
    } catch (error) {
      const result = await handleRelayException("Non-sponsored relay", error, log, kv);
      return returnWithCacheCheck(result);
    }
  }

  // Check settlement success
  if (!settleResult.success) {
    log.error("Payment settlement failed", {
      errorReason: settleResult.errorReason,
    });
    return {
      success: false,
      error: settleResult.errorReason || "Payment settlement failed",
      errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
      settleResult,
    };
  }

  // Extract payer address and transaction ID
  const payerStxAddress = settleResult.payer;
  const paymentTxid = settleResult.transaction || undefined;

  if (!payerStxAddress) {
    log.error("Settlement succeeded but no payer address");
    return {
      success: false,
      error: "Could not identify payer from payment",
      errorCode: X402_ERROR_CODES.SENDER_MISMATCH,
      settleResult,
    };
  }

  // Relay succeeded — reset circuit breaker so past failures don't linger.
  if (kv) {
    await resetCircuitBreaker(kv, RELAY_CIRCUIT_BREAKER_KEY);
  }

  log.info("Inbox payment verified", {
    payerStxAddress,
    paymentTxid,
    recipientStxAddress,
    paymentStatus: relayPaymentStatus,
    // Observability-only: accepted settlement state, not a caller-facing field.
    paymentLifecycle:
      relayPaymentStatus === "pending" ? "accepted_and_staged" : "accepted_and_confirmed",
  });
  emitPaymentEvent("info", "payment.accepted", {
    paymentId: relayPaymentId ?? null,
    status: relayPaymentStatus ?? "confirmed",
    action:
      relayPaymentStatus === "pending" ? "accept_payment_for_staging" : "accept_payment_for_delivery",
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid,
    settleResult,
    ...(relayPaymentStatus && { paymentStatus: relayPaymentStatus }),
    ...(relayTerminalReason && { terminalReason: relayTerminalReason }),
    ...(relayCheckStatusUrl && { checkStatusUrl: relayCheckStatusUrl }),
    ...(relayReceiptId && { receiptId: relayReceiptId }),
    ...(relayPaymentId && { paymentId: relayPaymentId }),
  };
}

/**
 * Verify a confirmed on-chain txid as payment proof for inbox message recovery.
 *
 * Recovery path for when x402 settlement times out but the sBTC transfer
 * succeeded on-chain. Validates the tx is a confirmed sBTC SIP-010 transfer
 * with sufficient amount to the expected recipient.
 */
export async function verifyTxidPayment(
  txid: string,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  logger?: Logger,
  kv?: KVNamespace,
  hiroApiKey?: string
): Promise<InboxPaymentVerification> {
  const log = logger || NOOP_LOGGER;

  // Normalize txid: ensure 0x prefix for Stacks API
  const normalizedTxid = txid.startsWith("0x") ? txid.slice(2) : txid;
  const fullTxid = `0x${normalizedTxid}`;

  const apiBase =
    network === "mainnet" ? STACKS_API_BASE : STACKS_API_TESTNET_BASE;

  log.info("Verifying txid payment recovery", {
    txid: fullTxid,
    recipientStxAddress,
    network,
  });

  const pendingCacheKey = `inbox:pending-txid:${normalizedTxid}`;
  let txData: StacksTxData;

  // 1. Confirmed transactions are immutable -- check positive cache first
  const cachedTx = await getCachedTransaction(normalizedTxid, kv, log) as StacksTxData | null;
  if (cachedTx) {
    log.info("Txid verification: cache hit", { txid: fullTxid });
    txData = cachedTx;
  } else {
    // 2. Negative cache: if this txid was recently checked, skip the API call.
    //    Cached value distinguishes "not_found" (404) from "not_confirmed" (seen but pending).
    if (kv) {
      const pendingEntry = await kv.get(pendingCacheKey);
      if (pendingEntry) {
        log.info("Txid verification: pending cache hit, skipping API call", { txid: fullTxid, cachedState: pendingEntry });
        if (pendingEntry === "not_confirmed") {
          return {
            success: false,
            error: "Transaction is known but not yet confirmed.",
            errorCode: "TX_NOT_CONFIRMED",
          };
        }
        return {
          success: false,
          error: "Transaction not found. It may not be confirmed yet.",
          errorCode: "TXID_NOT_FOUND",
        };
      }
    }

    // 3. Fetch from API
    try {
      const response = await stacksApiFetch(
        `${apiBase}/extended/v1/tx/${fullTxid}`,
        {
          method: "GET",
          headers: buildHiroHeaders(hiroApiKey),
        },
        { logger: log }
      );
      if (!response.ok) {
        if (response.status === 404) {
          // Cache the negative result to prevent repeated lookups.
          if (kv) {
            try {
              await kv.put(pendingCacheKey, "not_found", { expirationTtl: 300 });
            } catch (err) {
              log.warn("[verifyTxidPayment] KV pending cache write failed", { error: String(err), txid: fullTxid });
            }
          }
          return {
            success: false,
            error: "Transaction not found. It may not be confirmed yet.",
            errorCode: "TXID_NOT_FOUND",
          };
        }

        if (response.status === 429) {
          // All 429 retries exhausted by stacksApiFetch — surface as RATE_LIMITED so
          // the caller can return HTTP 429 with Retry-After guidance to the agent.
          const retryAfterMs = parseRetryAfterMs(response);
          const retryAfterSeconds = retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : 30;
          log.warn("[verifyTxidPayment] Stacks API rate limit exhausted", {
            txid: fullTxid,
            retryAfterSeconds,
          });
          return {
            success: false,
            error: "Stacks API rate limit reached. Please retry after a short delay.",
            errorCode: "RATE_LIMITED",
            retryAfterSeconds,
          };
        }

        return {
          success: false,
          error: `Stacks API error: ${response.status}`,
          errorCode: "API_ERROR",
          ...(response.status >= 500 && { retryAfterSeconds: 30 }),
        };
      }
      txData = (await response.json()) as StacksTxData;
    } catch (error) {
      log.error("Failed to fetch transaction", { error: String(error) });
      return {
        success: false,
        error: `Failed to verify transaction: ${String(error)}`,
        errorCode: "API_ERROR",
        retryAfterSeconds: 30,
      };
    }
  }

  // Require confirmed, successful transaction
  if (txData.tx_status !== "success") {
    log.warn("Transaction not successful", { status: txData.tx_status });
    // Cache the pending/failed state to prevent redundant API calls.
    if (kv) {
      try {
        await kv.put(pendingCacheKey, "not_confirmed", { expirationTtl: 300 });
      } catch (err) {
        log.warn("[verifyTxidPayment] KV pending cache write failed", { error: String(err), txid: fullTxid });
      }
    }
    return {
      success: false,
      error: `Transaction status is "${txData.tx_status}", expected "success"`,
      errorCode: "TX_NOT_CONFIRMED",
    };
  }

  // Fire-and-forget cache write for confirmed transactions
  if (!cachedTx) {
    setCachedTransaction(normalizedTxid, txData, kv, log).catch((err) => {
      log.warn("verifyTxidPayment.kv_cache_write_failed", {
        error: String(err),
        txid: fullTxid,
      });
    });
  }

  // Require contract call (not a token transfer or other tx type)
  if (txData.tx_type !== "contract_call" || !txData.contract_call) {
    return {
      success: false,
      error: "Transaction is not a contract call",
      errorCode: "INVALID_TX_TYPE",
    };
  }

  // Verify the call targets the sBTC token contract's transfer function
  const sbtcContract = SBTC_CONTRACTS[network];
  const expectedContractId = `${sbtcContract.address}.${sbtcContract.name}`;

  if (txData.contract_call.contract_id !== expectedContractId) {
    return {
      success: false,
      error: `Transaction is not an sBTC transfer (contract: ${txData.contract_call.contract_id})`,
      errorCode: "NOT_SBTC_TRANSFER",
    };
  }

  if (txData.contract_call.function_name !== "transfer") {
    return {
      success: false,
      error: `Unexpected function: ${txData.contract_call.function_name}`,
      errorCode: "NOT_SBTC_TRANSFER",
    };
  }

  // Parse SIP-010 transfer args: (amount uint, sender principal, recipient principal, memo (optional buff))
  const args = txData.contract_call.function_args;
  if (!args || args.length < 3) {
    return {
      success: false,
      error: "Cannot parse transfer arguments",
      errorCode: "INVALID_TX_ARGS",
    };
  }

  const amountArg = args.find((a) => a.name === "amount");
  const recipientArg = args.find((a) => a.name === "recipient");

  if (!amountArg || !recipientArg) {
    return {
      success: false,
      error: "Missing amount or recipient in transfer args",
      errorCode: "INVALID_TX_ARGS",
    };
  }

  // Parse Clarity uint repr (e.g., "u100")
  const amountMatch = amountArg.repr.match(/^u(\d+)$/);
  if (!amountMatch) {
    return {
      success: false,
      error: `Cannot parse amount: ${amountArg.repr}`,
      errorCode: "INVALID_TX_ARGS",
    };
  }
  const transferAmount = parseInt(amountMatch[1], 10);

  if (transferAmount < INBOX_PRICE_SATS) {
    return {
      success: false,
      error: `Transfer amount ${transferAmount} sats is below minimum ${INBOX_PRICE_SATS} sats`,
      errorCode: "INSUFFICIENT_AMOUNT",
    };
  }

  // Strip Clarity principal quote prefix ('SP... -> SP...)
  const recipientAddress = recipientArg.repr.replace(/^'/, "");
  if (recipientAddress !== recipientStxAddress) {
    return {
      success: false,
      error: `Transfer recipient ${recipientAddress} does not match expected ${recipientStxAddress}`,
      errorCode: "RECIPIENT_MISMATCH",
    };
  }

  const payerStxAddress = txData.sender_address;

  log.info("Txid payment verified", {
    txid: fullTxid,
    payerStxAddress,
    transferAmount,
    recipientStxAddress,
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid: normalizedTxid,
  };
}
