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
 * route. Lowercases the address for case-insensitive matching and
 * URL-encodes it so addresses containing reserved characters
 * (spaces, `/`, `#`, etc.) don't break `new Request(url)` and
 * surface client errors as 500s. The optional suffix is appended
 * verbatim — callers must pass URL-safe values (e.g.
 * `/reputation?type=summary`).
 */
export function buildEdgeCacheKey(
  routeBase: string,
  address: string,
  suffix = "",
): string {
  return `${CACHE_HOST}${routeBase}/${encodeURIComponent(address.toLowerCase())}${suffix}`;
}

/**
 * Resolve `caches.default` if available, otherwise null. The
 * Cloudflare Workers runtime exposes a global `caches` with a
 * `default` namespace; Node / `next dev` does not, so we guard
 * to let the handler fall through to the loader without
 * throwing in non-Workers environments.
 */
function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
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
  // `caches.default` is a Cloudflare Workers extension; absent in
  // Node / `next dev` runtimes. Fall through to the loader so
  // local development isn't broken by a missing global.
  const cache = getDefaultCache();
  if (!cache) return await loader();

  const cacheKey = new Request(cacheKeyUrl, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await loader();
  if (!response.ok) return response;

  // Don't overwrite a Cache-Control already set by the loader —
  // routes set their own client-facing directives (e.g.
  // s-maxage, stale-while-revalidate). The TTL we care about is
  // the one written into `caches.default`, which we apply only
  // to the cached clone via a fresh Response.
  const cachedClone = new Response(response.clone().body, response);
  cachedClone.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);

  const stash = cache.put(cacheKey, cachedClone);
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
 * Best-effort: per-URL deletes are independent — a single failed
 * delete is swallowed so one bad URL doesn't block the rest of
 * the invalidation set. No-op outside a Workers runtime.
 */
export async function invalidateEdgeCache(
  ...urls: string[]
): Promise<void> {
  const cache = getDefaultCache();
  if (!cache) return;
  await Promise.all(
    urls.map(async (u) => {
      try {
        await cache.delete(new Request(u, { method: "GET" }));
      } catch {
        // Best-effort — TTL expiry will heal naturally.
      }
    }),
  );
}
