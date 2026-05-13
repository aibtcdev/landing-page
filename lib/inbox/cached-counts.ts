/**
 * Edge-cache wrappers for inbox COUNT(*) queries that are called on every
 * heartbeat request.
 *
 * ## Why this file exists
 *
 * countInboxMessagesFromD1 fires a live SELECT COUNT(*) on every heartbeat GET
 * and POST. Agents heartbeat every 5 minutes; at ~1,000 registered agents the
 * call rate is ~288 COUNT(*) queries/agent/day = tens of millions of D1
 * rows-reads/day — the primary driver of the $30/day D1 bill spike (quest
 * 2026-05-13-d1-count-bill-stop, Phase P2).
 *
 * ## Cache strategy
 *
 * Uses `caches.default` (Cloudflare's per-colo in-process edge cache) to store
 * the count as a tiny JSON Response for 30 seconds. On cache hit, D1 is never
 * touched. On miss (first hit per address per colo per 30s window), the live
 * D1 query runs once and the result is cached for subsequent callers.
 *
 * `caches.default` is chosen over KV because:
 * - Zero additional KV read/write ops — the predecessor quest (P1) cut KV ops
 *   86%; we must not give that back.
 * - No network hop — caches.default is an in-process store inside the Worker.
 * - Already well-tested in this codebase (lib/edge-cache.ts, middleware.ts).
 *
 * ## TTL rationale: 30 seconds
 *
 * Heartbeat check-in rate limit is 5 minutes (CHECK_IN_RATE_LIMIT_MS = 300 000ms).
 * A 30s drift on unread count is invisible to agents — they learn about new
 * messages at most 30s late, but they only act on them at the next heartbeat
 * cycle anyway. Keeping TTL at 30s (not 60s+) is conservative and retains
 * reasonable freshness for the orientation step ("you have N unread messages").
 *
 * ## Scope
 *
 * Only the heartbeat path uses this wrapper. The inbox-list GET
 * (app/api/inbox/[address]/route.ts) intentionally uses the live
 * countInboxMessagesFromD1 directly — inbox reads are user-initiated and
 * benefit from real-time counts.
 *
 * ## Colo scope note
 *
 * caches.default is scoped per Cloudflare colo. Multiple colos will each miss
 * once per 30s window. That is acceptable — global consistency is not required
 * for heartbeat orientation.
 */

import { countInboxMessagesFromD1 } from "./d1-reads";

/** Synthetic cache host — isolated from live domain's HTTP cache namespace. */
const CACHE_HOST = "https://internal.cache";

/** TTL for cached unread counts (seconds). */
export const UNREAD_COUNT_CACHE_TTL_SECONDS = 30;

/**
 * Build the canonical cache key URL for an agent's unread count.
 * Address is lowercased so bc1q... and BC1Q... collapse to one entry.
 */
function buildUnreadCountCacheKey(btcAddress: string): string {
  return `${CACHE_HOST}/inbox-unread-count/${encodeURIComponent(btcAddress.toLowerCase())}`;
}

/**
 * Resolve `caches.default` if available, otherwise null.
 * Cloudflare Workers exposes a global `caches` with a `default` namespace;
 * Node / `next dev` does not, so we guard to let callers fall through to the
 * live D1 query without throwing in non-Workers environments.
 */
function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/**
 * Return the unread inbox count for an agent, served from a 30s edge cache
 * when available.
 *
 * - Cache hit: returns cached count with no D1 touch.
 * - Cache miss: queries D1 live, stores result for 30s.
 * - No caches.default (Node / next dev): queries D1 live every call.
 * - Any error (D1 unavailable, cache failure): returns 0 (fail-open, mirrors
 *   the fetchUnreadCount wrapper in the heartbeat route).
 */
export async function cachedUnreadCount(
  db: D1Database,
  btcAddress: string,
): Promise<number> {
  try {
    const cache = getDefaultCache();

    if (!cache) {
      // Non-Workers runtime (local dev, test env with no cache mock) —
      // fall through to live D1 query.
      return await countInboxMessagesFromD1(db, btcAddress, "unread");
    }

    const cacheKey = new Request(buildUnreadCountCacheKey(btcAddress), {
      method: "GET",
    });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const text = await cached.text();
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "number") return parsed;
      // Malformed cached value — fall through to live query.
    }

    // Cache miss: fetch from D1 and store.
    const count = await countInboxMessagesFromD1(db, btcAddress, "unread");

    const storedResponse = new Response(JSON.stringify(count), {
      headers: {
        "Content-Type": "application/json",
        // public + max-age satisfies caches.default's cacheable-response
        // requirements (no Set-Cookie, explicit Cache-Control directive).
        "Cache-Control": `public, max-age=${UNREAD_COUNT_CACHE_TTL_SECONDS}`,
      },
    });

    // Synchronous await is intentional: the put is an in-process write to
    // caches.default with no network hop, so latency is negligible and
    // ctx.waitUntil complexity is unwarranted here.
    await cache.put(cacheKey, storedResponse);

    return count;
  } catch {
    // Fail open — a transient D1 error or cache failure must not block heartbeat
    // orientation. Returning 0 means the agent sees "no unread messages" which
    // is a safe degradation (they won't be incorrectly told to check inbox).
    return 0;
  }
}
