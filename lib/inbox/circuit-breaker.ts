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
 */
export async function checkCircuitBreaker(
  kv: KVNamespace,
  key: string
): Promise<CircuitBreakerState> {
  const raw = await kv.get(key);
  if (!raw) return { open: false };
  try {
    const parsed = JSON.parse(raw) as { openedAt?: string };
    return { open: true, openedAt: parsed.openedAt };
  } catch {
    // Malformed entry — treat as open to be safe
    return { open: true };
  }
}

/**
 * Record a relay failure and open the circuit if the failure threshold is reached.
 *
 * Uses a separate failure counter key (key + ":count") with TTL to track
 * failures within a rolling window. When the counter reaches `threshold`,
 * writes the circuit-open marker with `ttlSeconds` expiry.
 */
export async function recordRelayFailure(
  kv: KVNamespace,
  key: string,
  threshold: number,
  ttlSeconds: number
): Promise<void> {
  const countKey = `${key}:count`;
  const raw = await kv.get(countKey);
  let count = 0;
  try {
    if (raw) count = parseInt(raw, 10) || 0;
  } catch {
    count = 0;
  }
  count += 1;

  // Always refresh the counter TTL to keep the window rolling
  await kv.put(countKey, String(count), { expirationTtl: ttlSeconds });

  if (count >= threshold) {
    const openedAt = new Date().toISOString();
    await kv.put(key, JSON.stringify({ openedAt }), { expirationTtl: ttlSeconds });
  }
}

/**
 * Reset the circuit breaker after a successful relay call.
 *
 * Deletes both the open marker and the failure counter so the circuit
 * starts fresh.
 */
export async function resetCircuitBreaker(
  kv: KVNamespace,
  key: string
): Promise<void> {
  await Promise.all([
    kv.delete(key),
    kv.delete(`${key}:count`),
  ]);
}
