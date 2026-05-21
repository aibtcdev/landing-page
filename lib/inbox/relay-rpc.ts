/**
 * RPC helpers for the X402_RELAY service binding.
 *
 * Caller-facing relay contracts come from `@aibtc/tx-schemas`; this file
 * only adapts them into the inbox route's legacy success/error envelope.
 */

import {
  RpcErrorCodeSchema,
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

/**
 * Wire fields surfaced by the x402-sponsor-relay alongside the canonical
 * schema-defined fields.  These are NOT yet part of the
 * `RpcSubmitPaymentResultSchema` in `@aibtc/tx-schemas` — `z.core.$strip` mode
 * would strip them — so we extract them BEFORE the zod parse and re-attach
 * after.  This keeps the LP forward-compatible: the moment the relay's RPC
 * binding starts surfacing these fields, downstream consumers (staging,
 * reconciliation, inbox UI) see them without further plumbing changes.
 *
 * Source contracts (merged 2026-05-19):
 * - `nonceExpiresAt`, `sponsorNonceValidForMs` — relay PR#379 + #383 (`/sponsor`
 *   success path).  Relay clock is authoritative; prefer over LP local
 *   derivation from `SPONSOR_NONCE_TTL_MS`.
 * - `responsible`, `agentErrorCode` — relay PR#381 (broadcast attribution
 *   on the error arm).  `responsible` discriminates sender/sponsor/network
 *   fault; `agentErrorCode` is the agent-facing reason code when
 *   `responsible === "sender"`.
 */
export interface RelayWireExtras {
  /** ISO 8601 UTC — relay-side TTL after which the sponsor nonce may be reclaimed. */
  nonceExpiresAt?: string;
  /** Duration in ms the sponsor nonce is valid (typically 600 000). */
  sponsorNonceValidForMs?: number;
  /** Attribution of a broadcast failure to sender, sponsor, or network. */
  responsible?: "sender" | "sponsor" | "network";
  /** Agent-facing reason code, set when `responsible === "sender"`. */
  agentErrorCode?: string;
}

export type RelaySubmitResult = z.infer<typeof RpcSubmitPaymentResultSchema> & RelayWireExtras;
export type RelayCheckResult = z.infer<typeof RpcCheckPaymentResultSchema> & RelayWireExtras;
type ParsedCheckPaymentResult = {
  result: RelayCheckResult;
  rawErrorCode?: string;
};

const RESPONSIBLE_VALUES = new Set(["sender", "sponsor", "network"]);

/**
 * Extract the new wire fields from a raw RPC response.  Returns only the
 * fields that are present and well-typed; unknown shapes (e.g. an old relay
 * that omits these fields entirely) return an empty object — callers must
 * treat all four fields as optional.
 */
function extractRelayWireExtras(raw: unknown): RelayWireExtras {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const extras: RelayWireExtras = {};
  if (typeof r.nonceExpiresAt === "string" && r.nonceExpiresAt.length > 0) {
    extras.nonceExpiresAt = r.nonceExpiresAt;
  }
  if (typeof r.sponsorNonceValidForMs === "number" && Number.isFinite(r.sponsorNonceValidForMs)) {
    extras.sponsorNonceValidForMs = r.sponsorNonceValidForMs;
  }
  if (typeof r.responsible === "string" && RESPONSIBLE_VALUES.has(r.responsible)) {
    extras.responsible = r.responsible as RelayWireExtras["responsible"];
  }
  if (typeof r.agentErrorCode === "string" && r.agentErrorCode.length > 0) {
    extras.agentErrorCode = r.agentErrorCode;
  }
  return extras;
}

/**
 * Typed interface for the X402_RELAY service binding RPC methods.
 * Must match the actual relay WorkerEntrypoint method signatures.
 */
export interface RelayRPC {
  submitPayment(txHex: string, settle?: RelaySettleOptions, paymentIdentifier?: string): Promise<RelaySubmitResult>;
  checkPayment(paymentId: string): Promise<RelayCheckResult>;
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
  // Idempotency: same identifier reused with a different payload (client misconfiguration)
  PAYMENT_IDENTIFIER_CONFLICT: "PAYMENT_REJECTED",
  // Broadcast failures
  BROADCAST_FAILED: "BROADCAST_FAILED",
  TX_BROADCAST_ERROR: "BROADCAST_FAILED",
  BROADCAST_RATE_LIMITED: "BROADCAST_FAILED",
  // Settlement
  SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
  // Insufficient funds
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  BALANCE_ERROR: "INSUFFICIENT_FUNDS",
  SPONSOR_EXHAUSTED: "INSUFFICIENT_FUNDS",
  // Nonce conflicts (retryable)
  NONCE_CONFLICT: "NONCE_CONFLICT",
  CLIENT_NONCE_CONFLICT: "NONCE_CONFLICT",
  CLIENT_BAD_NONCE: "NONCE_CONFLICT",
  TOO_MUCH_CHAINING: "NONCE_CONFLICT",
  ORIGIN_CHAINING_LIMIT: "NONCE_CONFLICT",
  NONCE_OCCUPIED: "NONCE_CONFLICT",
  // Payment identity expired/gone
  SENDER_HAND_EXPIRED: "PAYMENT_NOT_FOUND",
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
  // Validation failures (sender must fix and resubmit)
  invalid_transaction: "PAYMENT_REJECTED",
  not_sponsored: "PAYMENT_REJECTED",
  // Sender nonce rejections
  sender_nonce_stale: "SENDER_NONCE_STALE",
  sender_nonce_gap: "SENDER_NONCE_GAP",
  sender_nonce_duplicate: "SENDER_NONCE_DUPLICATE",
  // Sender chaining limit (retryable after drain — same InboxPaymentErrorCode as nonce conflict)
  origin_chaining_limit: "NONCE_CONFLICT",
  // Relay-internal failures
  queue_unavailable: "RELAY_ERROR",
  sponsor_failure: "RELAY_ERROR",
  sponsor_nonce_conflict: "RELAY_ERROR",
  internal_error: "RELAY_ERROR",
  // Sponsor wallet exhausted — no relay funds; treat as insufficient funds from client perspective
  sponsor_exhausted: "INSUFFICIENT_FUNDS",
  // Broadcast / settlement failures
  broadcast_failure: "BROADCAST_FAILED",
  broadcast_rate_limited: "BROADCAST_FAILED",
  chain_abort: "SETTLEMENT_FAILED",
  // Identity / expiry
  expired: "PAYMENT_NOT_FOUND",
  unknown_payment_identity: "PAYMENT_NOT_FOUND",
  sender_hand_expired: "PAYMENT_NOT_FOUND",
};

function parseSubmitPaymentResult(raw: unknown): RelaySubmitResult {
  const extras = extractRelayWireExtras(raw);

  if (
    raw &&
    typeof raw === "object" &&
    "accepted" in raw &&
    (raw as { accepted?: unknown }).accepted === true &&
    typeof (raw as { paymentId?: unknown }).paymentId !== "string"
  ) {
    const rawRecord = raw as Record<string, unknown>;
    return {
      accepted: true,
      status: "queued",
      ...(typeof rawRecord.checkStatusUrl === "string" && {
        checkStatusUrl: rawRecord.checkStatusUrl,
      }),
      ...extras,
    } as RelaySubmitResult;
  }

  if (
    raw &&
    typeof raw === "object" &&
    "accepted" in raw &&
    (raw as { accepted?: unknown }).accepted === false &&
    !("error" in raw)
  ) {
    const parsed = RpcSubmitPaymentResultSchema.parse({
      ...raw,
      error: "Payment submission rejected by relay",
    });
    return { ...parsed, ...extras };
  }

  const parsed = RpcSubmitPaymentResultSchema.parse(raw);
  return { ...parsed, ...extras };
}

function parseCheckPaymentResult(raw: unknown): RelayCheckResult {
  return parseCheckPaymentResponse(raw).result;
}

function parseCheckPaymentResponse(raw: unknown): ParsedCheckPaymentResult {
  const collapsed = collapseSubmittedStatus(raw);
  const extras = extractRelayWireExtras(collapsed);

  if (
    collapsed &&
    typeof collapsed === "object" &&
    "errorCode" in collapsed &&
    !RpcErrorCodeSchema.safeParse((collapsed as { errorCode?: unknown }).errorCode).success
  ) {
    const { errorCode, ...rest } = collapsed as Record<string, unknown>;
    return {
      result: { ...RpcCheckPaymentResultSchema.parse(rest), ...extras },
      ...(typeof errorCode === "string" && { rawErrorCode: errorCode }),
    };
  }

  return {
    result: { ...RpcCheckPaymentResultSchema.parse(collapsed), ...extras },
  };
}
export const __testUtils = {
  parseCheckPaymentResult,
  parseSubmitPaymentResult,
  extractRelayWireExtras,
};

/**
 * Derive a deterministic payment identifier from the transaction origin triple.
 *
 * The identifier is stable across retries of the exact same payment (same sender,
 * nonce, and recipient), enabling the relay to detect duplicate submissions and
 * return the cached result instead of re-processing.
 *
 * Shape: `pay_<28 hex chars>` (32 chars total) — satisfies PaymentIdentifierSchema
 * constraint `[a-zA-Z0-9_-]{16,128}` because hex chars are alphanumeric and `_`
 * is explicitly allowed.
 */
export async function derivePaymentIdentifier(
  senderAddress: string,
  nonce: string,
  recipientAddress: string
): Promise<string> {
  const idInput = `${senderAddress}|${nonce}|${recipientAddress}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(idInput));
  const hashHex = [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pay_${hashHex.slice(0, 28)}`;
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
 * Calls submitPayment(txHex, settle, paymentIdentifier) to enqueue the transaction,
 * then polls checkPayment() at RPC_POLL_INTERVAL_MS intervals up to RPC_POLL_MAX_ATTEMPTS
 * times or RPC_TOTAL_TIMEOUT_MS total.
 *
 * When paymentIdentifier is provided, the relay uses it for idempotency: a cache hit
 * with the same identifier and same payload returns the cached result; a cache hit
 * with the same identifier but a different payload returns PAYMENT_IDENTIFIER_CONFLICT
 * (mapped to PAYMENT_REJECTED).
 *
 * Throws on RPC call exceptions — the caller is responsible for catching
 * those and recording circuit breaker failures.
 */
export async function submitViaRPC(
  rpc: RelayRPC,
  txHex: string,
  settle: RelaySettleOptions | undefined,
  log: Logger,
  paymentIdentifier?: string
): Promise<InboxPaymentVerification> {
  const deadline = Date.now() + RPC_TOTAL_TIMEOUT_MS;
  let submitCheckStatusUrl: string | undefined;

  // Step 1: Submit the payment to the relay queue
  log.debug("RPC: submitting payment", { transaction: txHex.slice(0, 16) + "...", paymentIdentifier });
  const submitResult = parseSubmitPaymentResult(await rpc.submitPayment(txHex, settle, paymentIdentifier));

  if (!submitResult.accepted) {
    const errorCode = mapRPCErrorCode(submitResult.code);
    log.warn("RPC: submitPayment rejected", {
      code: submitResult.code,
      errorCode,
      error: submitResult.error,
      ...(submitResult.responsible && { responsible: submitResult.responsible }),
      ...(submitResult.agentErrorCode && { agentErrorCode: submitResult.agentErrorCode }),
    });
    return {
      success: false,
      error: submitResult.error || "Payment submission rejected by relay",
      errorCode,
      ...(submitResult.code != null && { relayCode: submitResult.code }),
      ...(submitResult.error && { relayDetail: submitResult.error }),
      ...(submitResult.responsible && { responsible: submitResult.responsible }),
      ...(submitResult.agentErrorCode && { agentErrorCode: submitResult.agentErrorCode }),
    };
  }

  const paymentId = submitResult.paymentId;
  if (!paymentId) {
    log.warn("RPC: submitPayment accepted but missing paymentId");
    return {
      success: false,
      error: "Relay accepted payment but did not return a canonical payment identity",
      errorCode: "MISSING_CANONICAL_IDENTITY",
      ...(submitResult.checkStatusUrl && { checkStatusUrl: submitResult.checkStatusUrl }),
    };
  }
  log.debug("RPC: payment queued", {
    paymentId,
    status: submitResult.status,
    ...(submitResult.warning && { warning: submitResult.warning.code }),
  });
  submitCheckStatusUrl = submitResult.checkStatusUrl;

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

    const { result: checkResult, rawErrorCode } = parseCheckPaymentResponse(
      await rpc.checkPayment(paymentId)
    );
    const relayCode = checkResult.errorCode ?? rawErrorCode;
    lastCheckResult = checkResult;
    log.debug("RPC: checkPayment", { attempt, paymentId, status: checkResult.status });

    if (checkResult.status === "confirmed") {
      const checkStatusUrl = selectCanonicalCheckStatusUrl(
        checkResult.checkStatusUrl,
        submitCheckStatusUrl
      );
      // Surface the submit-time nonce TTL on the confirmed arm too: the
      // nonce has already been consumed so the TTL is informational, but
      // downstream telemetry/logging can correlate it with the staged
      // record.  No fallback to `checkResult` here — once confirmed the
      // sponsor never re-emits a fresh TTL, so `submitResult` is the only
      // source.
      return {
        success: true,
        paymentTxid: checkResult.txid || "",
        paymentStatus: "confirmed",
        paymentId,
        ...(checkStatusUrl && { checkStatusUrl }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
        ...(submitResult.nonceExpiresAt && { nonceExpiresAt: submitResult.nonceExpiresAt }),
        ...(submitResult.sponsorNonceValidForMs != null && {
          sponsorNonceValidForMs: submitResult.sponsorNonceValidForMs,
        }),
      };
    }

    if (checkResult.status === "failed" || checkResult.status === "replaced") {
      const checkStatusUrl = selectCanonicalCheckStatusUrl(
        checkResult.checkStatusUrl,
        submitCheckStatusUrl
      );
      const errorCode = mapTerminalOutcome(checkResult);
      const responsible = checkResult.responsible ?? submitResult.responsible;
      const agentErrorCode = checkResult.agentErrorCode ?? submitResult.agentErrorCode;
      log.warn("RPC: payment failed", {
        paymentId,
        status: checkResult.status,
        terminalReason: checkResult.terminalReason,
        errorCode: relayCode,
        error: checkResult.error,
        ...(responsible && { responsible }),
        ...(agentErrorCode && { agentErrorCode }),
      });
      return {
        success: false,
        error: checkResult.error || `Payment ${checkResult.status}`,
        errorCode,
        paymentId,
        ...(checkStatusUrl && { checkStatusUrl }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
        ...(checkResult.txid && { paymentTxid: checkResult.txid }),
        ...(relayCode != null && { relayCode }),
        ...(checkResult.error && { relayDetail: checkResult.error }),
        ...(responsible && { responsible }),
        ...(agentErrorCode && { agentErrorCode }),
      };
    }

    if (checkResult.status === "not_found") {
      const checkStatusUrl = selectCanonicalCheckStatusUrl(
        checkResult.checkStatusUrl,
        submitCheckStatusUrl
      );
      log.warn("RPC: payment not found", {
        paymentId,
        terminalReason: checkResult.terminalReason,
        errorCode: relayCode,
        error: checkResult.error,
      });
      return {
        success: false,
        error:
          checkResult.error ||
          "Relay no longer recognizes this payment identity. Do not treat the message as delivered.",
        errorCode: "PAYMENT_NOT_FOUND",
        paymentId,
        ...(checkStatusUrl && { checkStatusUrl }),
        ...(checkResult.terminalReason && { terminalReason: checkResult.terminalReason }),
        ...(relayCode != null && { relayCode }),
        ...(checkResult.error && { relayDetail: checkResult.error }),
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
    const checkStatusUrl = selectCanonicalCheckStatusUrl(
      lastCheckResult?.checkStatusUrl,
      submitCheckStatusUrl
    );
    const nonceExpiresAt = submitResult.nonceExpiresAt ?? lastCheckResult?.nonceExpiresAt;
    const sponsorNonceValidForMs =
      submitResult.sponsorNonceValidForMs ?? lastCheckResult?.sponsorNonceValidForMs;
    log.info("RPC: poll exhausted after relay accepted — treating as pending success", {
      paymentId,
      lastStatus: lastStatus ?? "none",
      ...(lastCheckResult?.txid && { txid: lastCheckResult.txid }),
      ...(nonceExpiresAt && { nonceExpiresAt }),
    });
    return {
      success: true,
      paymentStatus: "pending",
      paymentId,
      ...(checkStatusUrl && { checkStatusUrl }),
      ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
      ...(nonceExpiresAt && { nonceExpiresAt }),
      ...(sponsorNonceValidForMs != null && { sponsorNonceValidForMs }),
    };
  }

  // Safety net: unexpected status at poll exhaustion (should not normally occur).
  log.warn("RPC: poll exhausted with unexpected status", {
    paymentId,
    lastStatus,
    attempts: RPC_POLL_MAX_ATTEMPTS,
  });
  const checkStatusUrl = selectCanonicalCheckStatusUrl(
    lastCheckResult?.checkStatusUrl,
    submitCheckStatusUrl
  );
  return {
    success: false,
    error: "RPC poll timed out waiting for settlement. Recover via paymentTxid.",
    errorCode: "SETTLEMENT_TIMEOUT",
    paymentId,
    ...(checkStatusUrl && { checkStatusUrl }),
    ...(lastCheckResult?.txid && { paymentTxid: lastCheckResult.txid }),
  };
}
