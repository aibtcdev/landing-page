# Cloudflare Cost Runbook

This repo is part of the April 2026 bill-reduction sprint. Every cost PR must
record the Cloudflare metric it is expected to move, the before/after window,
and the rollback signal.

Anchor analyses:
- `cloudflare-bill-audit-2026-04.md` (org root) — Issue D + F6 cover
  landing-page log/API noise and KV reads.
- `cloudflare-bill-reduction-tracker-2026-05.md` (org root) — B3 covers the
  landing-page items.

## B3: log noise + achievement timeout cache

PR scope:
- `lib/logging.ts`: deterministic `samplingFor(category, key)` helper. FNV-1a
  32-bit on the joined string; same `(category, key)` always wins/loses.
- `lib/identity/kv-cache.ts`: `logCacheEvent` now calls `samplingFor("cache.event", ...)`
  and emits at 5%. `sampled: true, sample_rate: 0.05` are added to the
  payload when the event passes the gate.
- `lib/identity/kv-cache.ts`: `isVerifyTimedOut` / `setVerifyTimedOut` /
  `isTimeoutError` for a transient-timeout sentinel cache (60s, separate
  `cache:verify-timeout:*` namespace).
- `lib/achievements/verify.ts`: the four `verify*Achievement` helpers
  (`Sender`, `sBTC Holder`, `Stacker`, `Inscriber`) check the sentinel at
  entry and write it on `TimeoutError` — subsequent calls within 60s
  short-circuit without re-fetching the upstream.
- `app/api/inbox/[address]/route.ts`: downgrade
  `Payment rejected: sender nonce state (expected)` from WARN to INFO. The
  message itself says "(expected)"; counting it as an alarm metric was
  noise.

Expected Cloudflare movement:
- Worker-logs `aibtc-landing` INFO/day: pre-PR ~22K → target ~1-2K (-90%+).
  Source: `https://logs.aibtc.com/stats/aibtc-landing`. Cache events (5%
  kept) become a small minority of INFO.
- Worker-logs `aibtc-landing` ERROR/day: pre-PR ~7-19 → target ~1-3 (-70%
  via the timeout cache). `mempool.space` upstream timeouts will still
  surface, but at most once per agent per minute, not per request.
- `aibtc-landing` total daily worker-logs ingest event count drops
  correspondingly.

Before/after window:
- Before: 24h production window immediately before deploy. Pull
  `/stats/aibtc-landing` for INFO/WARN/ERROR daily totals.
- Fast safety check: 15-30 minutes after deploy for 5xx on
  `/api/achievements/verify`, `/api/identity/[address]`, and the inbox
  routes; spot-check that name resolution and identity caching still serve
  through.
- Cost signal: capture the same 24h `/stats/aibtc-landing` window after
  deploy, then confirm again at 48h.

Cloudflare metric to record:
- `https://logs.aibtc.com/stats/aibtc-landing` daily totals.
- For sampling correctness: query a few hours of `/logs?app_id=aibtc-landing&level=INFO`
  and confirm cache events show `sample_rate: 0.05` and roughly 5% of the
  pre-PR cache event volume.

Dashboard fallback:
- Workers & Pages → `aibtc-landing` → Metrics for invocation counts and any
  upstream errors that escape worker-logs.

Rollback signal:
- Cache hit-rate observability gone for ~95% of events. Operator
  sanity-check: walk a single rayId trace through worker-logs and confirm
  cache events are present at the expected sampled fraction.
- Achievement-verify regressions: `verifySenderAchievement` /
  `verifySbtcHolderAchievement` / `verifyStackerAchievement` /
  `verifyInscriberAchievement` always returning `false` for a real positive
  case. Likeliest cause would be a stale sentinel surviving a deploy; the
  60s TTL caps that.
- Inbox route: payment-rejection volume incorrectly classified after the
  WARN→INFO downgrade. The downgrade only affects the `(expected)` branch;
  unexpected payment failures still emit ERROR.

Maintenance backstop:
- To temporarily restore full INFO visibility, set
  `SAMPLE_RATES["cache.event"] = 1` in `lib/logging.ts` and deploy. Roll
  back to `0.05` once the debug window closes.
- To clear a stuck timeout sentinel for a single agent, delete the
  `cache:verify-timeout:{scope}:{key}` KV entry from the
  `VERIFIED_AGENTS` namespace.

Local validation run for this change:

```sh
npm run typecheck
npx vitest run lib/__tests__/sampling.test.ts \
              lib/achievements/__tests__/verify-timeout-cache.test.ts
```
