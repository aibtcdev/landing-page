/**
 * Per-sender rate limiting for the inbox POST endpoint.
 *
 * Two-tier rate limits:
 * - Normal: 1 request per 60 seconds (prevents trivial flooding)
 * - Failure: 1 request per 60 seconds (applied when sender has a cached payment failure)
 *
 * The failure tier is checked via the Phase 1 payment failure cache, so senders
 * with empty sBTC wallets face an aggressive backoff automatically.
 *
 * Rate limiting only applies when a payment-signature header is present — the
 * first request that triggers a 402 response is not subject to rate limiting.
 *
 * Uses checkFixedWindowRateLimit from lib/rate-limit.ts for consistent KV-backed
 * fixed-window counting across the codebase.
 */

import {
  deserializeTransaction,
  StacksWireType,
  addressToString,
  addressHashModeToVersion,
} from "@stacks/transactions";
import { checkFixedWindowRateLimit } from "../rate-limit";
import { getCachedPaymentFailure } from "./payment-cache";
import {
  INBOX_SENDER_RATE_LIMIT_PREFIX,
  INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS,
  INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS,
} from "./constants";

/**
 * Extract the sender STX address from a serialized Stacks transaction hex string.
 *
 * Uses the origin's spending condition, which works for both standard and
 * sponsored auth types (the origin is the sender in both cases).
 *
 * Returns null if deserialization fails (invalid hex, truncated payload, etc.).
 * Callers should treat null as "sender unknown" and skip rate limiting.
 */
export function extractSenderStxAddress(
  txHex: string,
  network: "mainnet" | "testnet"
): string | null {
  if (!txHex) return null;
  try {
    const tx = deserializeTransaction(txHex);
    const sc = tx.auth.spendingCondition;
    const senderVersion = addressHashModeToVersion(sc.hashMode, network);
    return addressToString({
      type: StacksWireType.Address,
      version: senderVersion,
      hash160: sc.signer,
    });
  } catch {
    return null;
  }
}

/**
 * Check the per-sender inbox POST rate limit.
 *
 * @param kv - KV namespace
 * @param rateLimitKey - Key to use for the rate limit bucket (e.g., hash of payment header).
 *   This MUST NOT be derived from unverified sender data to prevent spoofed DoS.
 * @param senderStxAddress - Optional sender STX address for failure-tier lookup.
 *   Used only to check the payment failure cache (which is written after verification).
 *   If null/undefined, the normal (lenient) tier is used.
 *
 * Returns a result compatible with the checkFixedWindowRateLimit shape, plus
 * a hadPriorFailure flag indicating which tier was applied.
 *
 * Throws on KV errors — callers must catch and fail open (allow the request).
 * This matches the convention in the route handler where the call is wrapped
 * in try/catch with a logger.warn fallback.
 */
export async function checkSenderRateLimit(
  kv: KVNamespace,
  rateLimitKey: string,
  senderStxAddress?: string | null
): Promise<{
  limited: boolean;
  retryAfterSeconds: number;
  resetAt: string;
  hadPriorFailure: boolean;
}> {
  // Determine which tier applies — only check failure cache if we have a sender address
  let hadPriorFailure = false;
  if (senderStxAddress) {
    const cachedFailure = await getCachedPaymentFailure(kv, senderStxAddress);
    hadPriorFailure = cachedFailure !== null;
  }
  const ttlSeconds = hadPriorFailure
    ? INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS
    : INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS;

  const key = `${INBOX_SENDER_RATE_LIMIT_PREFIX}${rateLimitKey}`;
  const result = await checkFixedWindowRateLimit(kv, key, 1, ttlSeconds);

  return {
    limited: result.limited,
    retryAfterSeconds: result.retryAfterSeconds,
    resetAt: result.resetAt,
    hadPriorFailure,
  };
}
