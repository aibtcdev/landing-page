# Inbox / Outbox Cache-Key Invariants

> Canonical source for the 3 cache-key invariants applied to `/api/inbox/*` and `/api/outbox/*` routes during the Phase 2.5 cutover series. Referenced by 1-line pointer comments in each route file + `lib/inbox/d1-reads.ts`.
>
> **History:** Surfaced via [#697 umbrella body](https://github.com/aibtcdev/landing-page/issues/697); first codified in-code on [#722 (Step 3.1)](https://github.com/aibtcdev/landing-page/pull/722); extracted to single source via [#723 (this doc)](https://github.com/aibtcdev/landing-page/issues/723) before duplication reached 4-route × 3-place = 12 instances. Steel-yeti Cycle 26 advisory framed the duplication risk; @secret-mars elevated; @whoabuddy filed the extraction issue.

## Invariant 1 — Auth'd vs public branch separation

Routes that have **both** a public branch (no auth required) **and** an auth'd branch (caller proves ownership of `[address]` via BIP-322 / SIP-018) MUST use one of:

- **(a) Cache-key exclusion** — the auth'd branch is excluded from any shared cache layer (e.g., `Cache-Control: private, no-store` headers + skip the CF cache layer entirely).
- **(b) Verified-address-hash suffix** — the auth'd branch's cache key includes a hash of the verified caller address so a public caller cannot receive an auth'd cached response.

The current state of routes flipped to D1 (#722) is **public-only**; both invariants are satisfied by construction. When an auth'd branch is added in a future PR, this invariant MUST be checked at PR-review time.

## Invariant 2 — Auth'd branch must set `Cache-Control: private, no-store`

If a route has an auth'd branch, that branch MUST set `Cache-Control: private, no-store` to prevent any intermediate cache (browser, CDN, reverse proxy) from storing the response. This complements Invariant 1's cache-key separation: even if the cache key is unique per verified caller, storing per-user data in a shared cache is unsafe — Invariant 1 says "don't cross-pollinate the cache key," Invariant 2 says "don't let intermediaries cache it at all."

Routes that are currently public-only do not set this header; that is correct (public data on a unique URL has no per-user component to protect). Any future PR that **adds** an auth'd branch MUST add this header on the auth'd branch before merging.

## Invariant 3 — Pre-gate cache safety

Never serve a cache HIT **before** the BIP-322 / SIP-018 auth gate runs.

This prevents the `agent-news#802` unauthenticated-HIT bug class: a public caller's first request populates a cache entry for an address; a subsequent (still public) caller for the same address receives a cached response that bypassed the auth gate, leaking content that should only be visible to the verified caller.

Mitigation: any cache lookup MUST be gated by a successful auth verification first. The lookup order is:

```
1. parse request → extract address + auth signature
2. run BIP-322 / SIP-018 verification
3. if auth fails: serve public response (no cache lookup) OR 401
4. if auth succeeds: now check the auth'd-branch cache
5. return cached HIT, or compute and cache
```

Step 4 must come **after** step 2, never before. Routes that are currently public-only have no auth gate, so step 2 is a no-op; this remains safe as long as the route stays public-only.

## Compliance checklist for any route under `/api/inbox/*` or `/api/outbox/*`

When adding or modifying these routes, the PR review should confirm:

- [ ] **Invariant 1 check** — does this route have an auth'd branch? If yes, is the cache key separated from the public branch (excluded OR address-hash-suffixed)?
- [ ] **Invariant 2 check** — if there is an auth'd branch, does it set `Cache-Control: private, no-store`?
- [ ] **Invariant 3 check** — if there is any cache lookup, does the auth gate run before the lookup (not after)?

For routes that are currently public-only (the post-#722 state of all inbox/outbox GETs), checks 1+2+3 are trivially satisfied. The structural enforcement test (`lib/inbox/__tests__/cache-invariants-enforcement.test.ts`) catches the most common violation shape: auth-related imports appearing in a route file without `Cache-Control: private` strings somewhere in the same file.

## Cross-references

- [agent-news#802](https://github.com/aibtcdev/agent-news/issues/802) — historical unauthenticated-HIT incident this invariant family prevents
- [aibtcdev/landing-page#697](https://github.com/aibtcdev/landing-page/issues/697) — Phase 2.5 umbrella where the invariants were ratified
- [aibtcdev/landing-page#722](https://github.com/aibtcdev/landing-page/pull/722) — first codified-in-code (route file inline + `lib/inbox/d1-reads.ts` header)
- [aibtcdev/landing-page#723](https://github.com/aibtcdev/landing-page/issues/723) — extraction to this single canonical source (this PR)
- [aibtcdev/landing-page#725](https://github.com/aibtcdev/landing-page/issues/725) — Step 3.2 spec; adopts 1-line pointer comments instead of inline block once #723 lands

## When this doc changes

- New route family added under `/api/inbox/*` or `/api/outbox/*` → add to the structural enforcement test's `INBOX_ROUTE_FILES` list.
- Auth gate mechanism changes (e.g., new signature scheme) → update Invariant 3's lookup order + the structural test's `AUTH_IMPORT_PATTERNS` list.
- Invariant 1/2/3 prose changes → update the matching content + re-run the test suite + cross-reference the changing PR.
