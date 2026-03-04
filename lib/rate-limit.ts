/**
 * Fixed-window KV rate limiter. Stores "count:windowStartMs" so each write
 * preserves the original window expiry. KV read-then-write is not atomic;
 * minor under-counting under concurrency is accepted.
 *
 * @returns { limited, retryAfterSeconds, resetAt } — limited is true when count >= max;
 *          retryAfterSeconds is the time remaining in the current window;
 *          resetAt is the ISO 8601 timestamp when the window resets.
 */
export async function checkFixedWindowRateLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  ttlSeconds: number
): Promise<{ limited: boolean; retryAfterSeconds: number; resetAt: string }> {
  const now = Date.now();
  const raw = await kv.get(key);

  let count = 0;
  let windowStart = now;
  let isNewWindow = !raw;

  if (raw) {
    const parts = raw.split(":");
    count = parseInt(parts[0], 10) || 0;
    const parsedStart = parseInt(parts[1], 10);
    if (isNaN(parsedStart)) {
      // Legacy key (count only, no timestamp) — treat as expired window
      count = 0;
      windowStart = now;
      isNewWindow = true;
    } else {
      windowStart = parsedStart;
    }

    // If the window has expired (KV key outlived its TTL, e.g. pre-#294
    // stuck keys or eventual consistency lag), start a fresh window.
    if ((now - windowStart) / 1000 >= ttlSeconds) {
      count = 0;
      windowStart = now;
      isNewWindow = true;
    }
  }

  const elapsedSeconds = (now - windowStart) / 1000;
  const remainingSeconds = Math.max(1, Math.ceil(ttlSeconds - elapsedSeconds));
  const resetAt = new Date(windowStart + ttlSeconds * 1000).toISOString();

  if (count >= max) return { limited: true, retryAfterSeconds: remainingSeconds, resetAt };

  const value = `${count + 1}:${windowStart}`;
  await kv.put(key, value, { expirationTtl: isNewWindow ? ttlSeconds : remainingSeconds });
  return { limited: false, retryAfterSeconds: remainingSeconds, resetAt };
}
