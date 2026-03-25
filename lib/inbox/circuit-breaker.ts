/**
 * KV-backed circuit breaker for x402 relay calls.
 *
 * Prevents cascading failures by opening (disabling) relay calls after
 * repeated failures within a time window. Returns 503 to clients when open.
 *
 * States:
 * - Closed (normal): relay calls proceed.
 * - Open: relay calls are blocked; clients receive 503 with retryAfter.
 *
 * The circuit resets automatically when the KV TTL expires.
 *
 * All KV operations fail open: a transient KV error will never block
 * an otherwise valid payment request or crash a successful settlement.
 */

/** Result of a circuit breaker check. */
export interface CircuitBreakerState {
  open: boolean;
  openedAt?: string;
}

/**
 * Check whether the circuit breaker is currently open.
 *
 * Returns `{ open: true, openedAt }` when the circuit is open,
 * or `{ open: false }` when closed (relay calls may proceed).
 * Fails open on KV errors (returns closed).
 */
export async function checkCircuitBreaker(
  kv: KVNamespace,
  key: string
): Promise<CircuitBreakerState> {
  try {
    const raw = await kv.get(key);
    if (!raw) return { open: false };
    try {
      const parsed = JSON.parse(raw) as { openedAt?: string };
      return { open: true, openedAt: parsed.openedAt };
    } catch {
      // Malformed entry — treat as open to be safe
      return { open: true };
    }
  } catch {
    // KV read failed — fail open so payments aren't blocked
    return { open: false };
  }
}

/**
 * Record a relay failure and open the circuit if the failure threshold is reached.
 *
 * Uses a separate failure counter key (key + ":count") with TTL to track
 * failures within a rolling window. When the counter reaches `threshold`,
 * writes the circuit-open marker with `ttlSeconds` expiry.
 * Silently swallows KV errors to avoid failing the payment request.
 */
export async function recordRelayFailure(
  kv: KVNamespace,
  key: string,
  threshold: number,
  ttlSeconds: number
): Promise<void> {
  try {
    const countKey = `${key}:count`;
    const raw = await kv.get(countKey);
    const count = (raw ? parseInt(raw, 10) || 0 : 0) + 1;

    // Always refresh the counter TTL to keep the window rolling
    await kv.put(countKey, String(count), { expirationTtl: ttlSeconds });

    if (count >= threshold) {
      const openedAt = new Date().toISOString();
      await kv.put(key, JSON.stringify({ openedAt }), { expirationTtl: ttlSeconds });
    }
  } catch {
    // KV write failed — circuit breaker degrades gracefully
  }
}

/**
 * Reset the circuit breaker after a successful relay call.
 *
 * Deletes both the open marker and the failure counter so the circuit
 * starts fresh. Silently swallows KV errors so a successful relay
 * settlement is never disrupted by a KV issue.
 */
export async function resetCircuitBreaker(
  kv: KVNamespace,
  key: string
): Promise<void> {
  try {
    await Promise.all([
      kv.delete(key),
      kv.delete(`${key}:count`),
    ]);
  } catch {
    // KV delete failed — stale circuit state will expire via TTL
  }
}
