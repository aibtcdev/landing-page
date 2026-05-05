/**
 * Worker-internal edge cache layer for stable identity GET
 * responses.
 *
 * Wraps a route handler so cache hits skip the handler entirely —
 * including all KV reads, identity lookups, and JSON rendering
 * that the live request would have done. Drives the bulk of the
 * post-B6.1 / B6.2 KV-read reduction by collapsing the per-request
 * profile fan-out to zero on repeat hits.
 *
 * Cache keys use a synthetic `cache.aibtc.local` host so they
 * don't pollute the live domain's HTTP cache namespace and stay
 * isolated from any zone-level cache rules. Address values are
 * lowercased for canonical matching (so `/api/agents/SP...` and
 * `/api/agents/sp...` collapse to one entry).
 *
 * Only successful (`response.ok`) responses are cached. Errors
 * fall through every time so a transient upstream issue doesn't
 * pin a 500 for the TTL window.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

const CACHE_HOST = "https://cache.aibtc.local";

/**
 * Build the canonical edge-cache URL for a stable identity-keyed
 * route. Lowercases the address for case-insensitive matching;
 * the optional suffix is appended verbatim (already prefixed with
 * `/` by the caller).
 */
export function buildEdgeCacheKey(
  routeBase: string,
  address: string,
  suffix = "",
): string {
  return `${CACHE_HOST}${routeBase}/${address.toLowerCase()}${suffix}`;
}

/**
 * Wrap a GET handler with a Cloudflare edge-cache layer.
 *
 * On cache hit the loader is never called — return is immediate
 * with the cached Response (still streamable for the client).
 *
 * On cache miss the loader runs, the response is cloned, and the
 * cache write runs asynchronously via `ctx.waitUntil` so the
 * client sees the response immediately. Only successful
 * (`response.ok`) responses are cached.
 */
export async function withEdgeCache(
  cacheKeyUrl: string,
  ttlSeconds: number,
  loader: () => Promise<Response>,
): Promise<Response> {
  // `caches.default` is a Cloudflare Workers extension to the
  // standard CacheStorage interface (which only declares `open()`).
  // Cast to access the runtime-provided default namespace.
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(cacheKeyUrl, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await loader();
  if (!response.ok) return response;

  response.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);

  const stash = cache.put(cacheKey, response.clone());
  const { ctx } = await getCloudflareContext();
  if (ctx) {
    ctx.waitUntil(stash);
  } else {
    await stash;
  }

  return response;
}

/**
 * Invalidate one or more cached entries by canonical URL. Used
 * on the `/api/identity/{address}/refresh` write path so users
 * who explicitly request a refresh see fresh state immediately
 * instead of waiting out the TTL.
 *
 * Best-effort: a failed delete logs and continues; the next
 * cache miss after the TTL expires will heal naturally.
 */
export async function invalidateEdgeCache(
  ...urls: string[]
): Promise<void> {
  // `caches.default` is a Cloudflare Workers extension to the
  // standard CacheStorage interface (which only declares `open()`).
  // Cast to access the runtime-provided default namespace.
  const cache = (caches as unknown as { default: Cache }).default;
  await Promise.all(
    urls.map((u) => cache.delete(new Request(u, { method: "GET" }))),
  );
}
