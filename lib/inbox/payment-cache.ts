/**
 * Per-sender payment failure cache for the x402 inbox system.
 *
 * When the relay returns INSUFFICIENT_FUNDS, caches the result per sender
 * in KV with a 5-minute TTL. Subsequent requests from the same sender return
 * the cached error immediately, skipping the relay call entirely.
 *
 * This stops relay flooding from agents with empty sBTC wallets (issue #523).
 * An agent with zero sBTC cannot pay regardless of how many times it retries —
 * the balance will not change without explicit wallet action.
 *
 * All KV operations fail open: a transient KV error will never block
 * an otherwise valid payment request.
 */

import type { PaymentFailureCache } from "./types";
import {
  PAYMENT_FAILURE_CACHE_PREFIX,
  PAYMENT_FAILURE_CACHE_TTL_SECONDS,
} from "./constants";

/**
 * Check whether a payment failure is cached for this sender.
 *
 * Returns the cached PaymentFailureCache record when a hit is found,
 * or null on a cache miss, malformed entry, or KV error (fail-open).
 */
export async function getCachedPaymentFailure(
  kv: KVNamespace,
  senderStxAddress: string
): Promise<PaymentFailureCache | null> {
  try {
    const key = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    const raw = await kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PaymentFailureCache;
    } catch {
      // Malformed entry — treat as miss so the sender gets a fresh relay attempt
      return null;
    }
  } catch {
    // KV read failed — fail open so payments aren't blocked
    return null;
  }
}

/**
 * Cache a payment failure for this sender.
 *
 * Writes a PaymentFailureCache record with PAYMENT_FAILURE_CACHE_TTL_SECONDS expiry.
 * Silently swallows KV errors to avoid disrupting the caller's error response.
 */
export async function cachePaymentFailure(
  kv: KVNamespace,
  senderStxAddress: string,
  errorCode: string
): Promise<void> {
  try {
    const key = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    const record: PaymentFailureCache = {
      senderStxAddress,
      errorCode,
      cachedAt: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: PAYMENT_FAILURE_CACHE_TTL_SECONDS,
    });
  } catch {
    // KV write failed — cache degrades gracefully; next request will hit the relay again
  }
}
