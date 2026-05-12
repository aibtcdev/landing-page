# Edge-Cache PR Checklist

Closes #782. Land this doc reference alongside any PR that touches the edge-cache layer (Workers `caches.default` API, `lib/edge-cache.ts` helpers, or write-path invalidation).

The fields below were distilled from the steel-yeti Council Cycle 3/4/7/8 advisories during the P3.2/P3.3 campaign (PRs #774, #775). Each field corresponds to a finding that recurred across sibling PRs until the campaign converged on a shared shape. Filling out this checklist in the PR description means the next P3 sibling doesn't re-discover the same six concerns ad-hoc.

## When this checklist applies

Fill it out in the PR body for any change that:

- Adds a new `withEdgeCache(...)` wrapper around a route handler
- Adds or modifies a `buildEdgeCacheKey(...)` / `buildMiddlewareOgCacheKey(...)` call site
- Adds or modifies cache invalidation (`invalidateEdgeCache`, `purgeMiddlewareOgCache`) on a write-path route
- Reads from or writes to `caches.default` directly (rare — prefer `lib/edge-cache.ts` wrappers)

If you're only changing rate-limit bindings, KV-only paths, or D1-only paths with no edge-cache surface, skip the checklist.

## Required fields

### 1. Cache namespace

Which Workers cache namespace does this PR touch? In practice this is one of:

- `caches.default` — global per-zone Workers cache (see `lib/edge-cache.ts:withEdgeCache`)
- `caches.default` — middleware OG cache, keyed under the `middleware:og:` prefix (see `lib/edge-cache.ts:buildMiddlewareOgCacheKey`)
- A KV binding (`VERIFIED_AGENTS`, etc.) — note this is NOT the Workers cache layer; KV reads/writes have different semantics

State the binding name explicitly. If the PR is multi-layer (cache + KV), list each.

### 2. Canonical key builder

Which function from `lib/edge-cache.ts` builds the cache key — for **both** the read and the write path? The read path and write/purge path **must use the same builder function** (Cycle 3 / 4 finding on #774: cache-key duplication caused mismatched read/purge keys when the inline template literal drifted from the helper). Available builders today:

- `buildEdgeCacheKey(routePath, address, [suffix])` — for `/api/og/[address]`, `/api/agents/[address]`, `/api/identity/[address]` etc.
- `buildMiddlewareOgCacheKey(address)` — for the middleware crawler-agent OG cache (btc:/stx:-keyed only — see Phase 2.3 scope)

If a new builder is needed, add it to `lib/edge-cache.ts` so it can be shared across read and write paths.

### 3. Purge helper

Which helper clears cached entries on the write path? State the input shape, whether it's best-effort (errors swallowed) or throws on failure, and what happens to the response if the purge fails. Available helpers today:

- `invalidateEdgeCache(...urls)` — best-effort; throws are silenced via inner try/catch per call
- `purgeMiddlewareOgCache(address)` — best-effort; logs on failure but doesn't throw

If your PR introduces a new write path that needs invalidation, prefer adding a helper to `lib/edge-cache.ts` rather than inlining the cache API call — keeps purge semantics consistent across routes (Cycle 9 retrospective recommendation on #780).

### 4. Affected write paths

Exhaustive list of API routes that mutate data which would render cached entries stale. For each, confirm the purge call is wired up. Common write-path roots:

- `POST /api/challenge` (claim verification flow — invalidates `/api/og`, middleware OG)
- `POST /api/identity/[address]/refresh` (force-refresh BNS / agent identity — invalidates `/api/agents`, `/api/identity`, `/api/og`, middleware OG)
- `POST /api/register` (initial agent registration — invalidates agent-list + agents:index)
- `PATCH /api/agents/[address]/inbox/[msgId]` (mark-read — does NOT currently invalidate edge cache for `/api/agents` profile reads; that's a known gap)
- Any new route that mutates fields read by a cached route surface

Note any intentionally-excluded mutations (e.g. heartbeat updates `lastActiveAt` but doesn't invalidate `/api/og` because the OG image doesn't render that field).

### 5. Vary behavior

Which request headers does the cached response vary on? Confirm the `Vary` header is preserved on cached clones in both the live response and any cache.put() call.

The pattern from #774's Cycle 7 fixup (`middleware.ts`) uses `new Headers(response.headers)` to copy headers into a fresh object so deleting/setting on the clone never mutates the live response. The `Vary: User-Agent` header is essential for middleware crawler-agent caching — without it, downstream shared caches would serve the crawler-only HTML to non-crawler clients.

If your PR varies the response on a header other than `User-Agent` (e.g. `Accept-Language` for i18n), state the dimension and confirm the `Vary` carry-through.

### 6. waitUntil / non-blocking behavior

Confirm cache writes (`cache.put`) are non-blocking via `ctx.waitUntil(stash)` so the client receives the live response immediately without waiting for the write. The pattern from `middleware.ts` (post-#774 merge) handles both environments:

```ts
if (ctx) {
  ctx.waitUntil(stash);
} else {
  // Node / next dev — no ctx; fire-and-forget with an explicit .catch
  void stash.catch(() => {
    // Best-effort — TTL expiry will heal naturally.
  });
}
```

The Workers path uses `ctx.waitUntil(stash)` so the Cloudflare runtime consumes the promise (no unhandled-rejection risk). The Node/dev path uses `void stash.catch(() => {})` to attach an explicit handler.

Test scaffold needs `caches.default.put` mock to not reject (or to explicitly assert error handling — see `lib/__tests__/middleware-crawler.test.ts` test 12).

## Optional field

### 7. Zone-CDN behavior

If the cached response carries `Cache-Control: s-maxage=*` and the route is served via the `aibtc.com` custom-domain route (per `wrangler.jsonc`), Cloudflare's zone CDN will cache the response at the edge for `s-maxage` seconds. This is **separate** from the worker-internal `caches.default` cache; purging `caches.default` does NOT purge zone CDN.

Per #781: today the worker has no zone-cache-purge API integration, so zone CDN can serve stale up to `s-maxage` after a worker-side invalidation. The mitigation is operator manual purge from the CF dashboard for high-visibility staleness. If your PR sets `s-maxage` differently from the `max-age` used for worker-internal cache, note the tradeoff in the PR body (current convention: `s-maxage=3600` for `/api/og` to leverage zone-CDN absorption of social-card fan-out; `max-age=300` internal).

## Example checklist (filled out, from a hypothetical P4.2 heartbeat dual-write PR)

```
### Edge-cache PR checklist (per docs/edge-cache-pr-checklist.md)

1. **Cache namespace**: `caches.default` via `withEdgeCache` on `/api/agents/[address]`; also middleware OG cache via `buildMiddlewareOgCacheKey`.
2. **Canonical key builder**: `buildEdgeCacheKey("/api/agents", address)` for the read+invalidate paths; `buildMiddlewareOgCacheKey(address)` for the middleware OG layer.
3. **Purge helper**: `invalidateEdgeCache(...urls)` for CDN-layer; `purgeMiddlewareOgCache(address)` for middleware-OG. Both best-effort.
4. **Affected write paths**: `POST /api/heartbeat` (new; updates `lastActiveAt` + `unreadInboxCount`). Excluded: `PATCH /api/agents/[address]/inbox/[msgId]` is the existing read-update path; this PR doesn't change its invalidation behavior.
5. **Vary**: `Vary: User-Agent` preserved on middleware OG cached clones. `/api/agents` response varies only on path (no header-Vary needed).
6. **waitUntil**: `ctx.waitUntil(cache.put(...))` for Workers path; `void stash.catch(() => {})` for Node/dev fallback.
7. **Zone-CDN**: `/api/agents` keeps `s-maxage=300` (5min) — heartbeat updates are frequent enough that longer zone-CDN staleness would be visible. Tradeoff documented; no zone-purge needed since TTL window is short.
```

## Reference implementations

- **Cycle-3-to-merge fix-pattern**: PR #774 (`6f79f647`) — full P3.2 edge-cache pattern with all six fields addressed; `middleware.ts` shows the ctx.waitUntil pattern, `lib/edge-cache.ts` shows the shared builder + helper, `lib/__tests__/middleware-crawler.test.ts` shows the cache-mock test scaffold.
- **Unification target**: PR #780 (in flight) — shared `invalidateAllOgCaches` helper extraction; will subsume the parallel invocation patterns in `app/api/challenge/route.ts` and `app/api/identity/[address]/refresh/route.ts`.
- **Zone-CDN staleness gap**: #781 — pre-existing constraint, not a regression; mitigation is operator manual purge.

## Maintenance

Update this checklist when:

- A new shared helper lands in `lib/edge-cache.ts` (add to the field-2/field-3 helper list)
- A new cache namespace gets used (e.g. KV-as-cache for a new domain)
- A council retrospective surfaces a 7th repeated finding worth promoting to a required field
- The zone-CDN purge gap closes (#781 lands) — at which point field 7 moves into required and the manual-purge mitigation note becomes obsolete

History:

- 2026-05-12: Initial doc per #782, distilled from Cycle 3/4/7/8 findings on #774 and #775.
