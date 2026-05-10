# D1 Reconciliation Baseline (Phase 1.4 gate)

**Last verified:** 2026-05-10T02:03Z
**Worker version:** `5ed509c9-e0e0-4a6c-b9fa-35711cfbe281` (main HEAD `96fbc6e`)
**Backfill production run:** 2026-05-09T23:55Z (PR #672 + secret-mars's Tier 1 fix-up `c777549`)

This document is the authoritative reconciliation baseline produced as part of Phase 1.4 of the [D1 migration](https://github.com/aibtcdev/landing-page/issues/652). It establishes the per-table KV ↔ D1 row-count comparison and the categorical breakdown of all explained drift, satisfying the "zero unexplained drift" gate before Phase 2.x read flips.

The route at `app/api/admin/reconcile/route.ts` regenerates these numbers on demand for agents/claims/vouches; the inbox per-row verification is queued as a separate pagination refactor (see "Open follow-up" below).

## Per-table baseline

| Table | KV total | D1 count | Drift | Drift explained | Drift unexplained | Verified by |
|-------|---------:|---------:|------:|----------------:|-------------------:|-------------|
| `agents` | **951** (post-partial-filter; 0 partial excluded; 708 invalid surfaced via `kv_count_invalid_excluded`) | 243 | **708** | 708 (`kv_count_invalid_excluded` — strict-required-field rejection per backfill validation) | **0 ✅** | reconcile route, route-level |
| `claims` | **577** | 123 | **454** | 454 (FK cascade from invalid agents) | **0 ✅** | reconcile route, route-level |
| `inbox_messages` | **7761** (5223 inserted + 2538 backfill rejects) | 5223 | **2538** | 2538 (categorical breakdown below) | **0 ✅** (count-level) / pagination needed for per-row | count + categorical breakdown derived from the Phase 1.3 backfill operational summary on [#671](https://github.com/aibtcdev/landing-page/issues/671); route-level per-row verification queued at [#684](https://github.com/aibtcdev/landing-page/issues/684) |
| `vouches` | **95** | 30 | **65** | 65 (FK cascade) | **0 ✅** | reconcile route, route-level |

Reconcile route's response shape includes a per-table `explained_categories` field that surfaces this breakdown on demand. Numbers above are the operational run output; expected to remain stable absent net-new agent registrations or inbox writes.

## Inbox drift breakdown (2538)

The 2538 inbox_messages drift is fully accounted for by three Phase-1.3-design-time skip categories:

| Category | Count | Cause |
|----------|------:|-------|
| FK constraint failed (`partial_cascade`) | 2529 | Recipient agent not in D1 — either PartialAgentRecord or "invalid" record (missing required field per backfill validation). All 708 invalid agents from the agents table cascade through here, plus inbound messages whose `toBtcAddress` was a Partial agent. |
| UNIQUE on `payment_txid` (`unique_payment_txid_replay`) | 7 | Same `payment_txid` reused across multiple KV records. RFC §1 specifies `payment_txid` as PERMANENTLY unique (replaces the prior 90-day TTL behavior on `inbox:redeemed-txid:`). D1 correctly rejects duplicates. |
| Unresolvable STX `replyTo` (`unresolvable_stx_reply`) | 2 | `OutboxReply.toBtcAddress` held an STX address whose `kv:stx:{addr}` lookup either returned null or had no `btcAddress` field. Backfill's STX→BTC resolver helper from `c777549` couldn't translate. Sample keys logged in the backfill artifact. |
| **Total** | **2538** | = drift |

## Reconciliation arithmetic check

```
KV total inbox_messages    = 7761  (per `kv.list` count)
D1 inbox_messages          = 5223  (per SELECT COUNT(*))
Drift                      = 7761 - 5223 = 2538
Backfill `failed[].length` = 2538  (per operational artifact)
Sum of explained categories = 2529 + 7 + 2 = 2538

→ drift_unexplained = 2538 - 2538 = 0
```

No "small variance" — the figures balance to the row.

## Per-table verification methods

- **Agents (route-level):** `buildFullAgentSet` enumerates KV `btc:` prefix, classifies each record via `isPartialAgentRecord` + the strict-required-field check (matching backfill validation in `app/api/admin/backfill/route.ts:174-195`). Three distinct counts — `kv_count` (full), `kv_count_partial_excluded`, `kv_count_invalid_excluded` — are surfaced in the route's response.
- **Claims (route-level):** scans `claim:` prefix; for each KV claim's `btcAddress`, checks `fullAgents.has(addr)`; rows whose parent agent isn't full are bucketed as `partial_cascade`. PR #680 introduced this KV-truth-based detection (replacing the prior D1-existence check that misclassified backfill failures as explained).
- **Vouches (route-level):** scans `vouch:` prefix; checks both `referrer` and `referee` against `fullAgents`. Same `partial_cascade` model.
- **Inbox (artifact-level today; route-level pending pagination):** the route's count pass exceeds Cloudflare Workers' 1000-subrequest-per-invocation limit on Workers Paid (~12K subrequests needed). Count + categorical-breakdown verification today comes from this document, derived from the operational backfill summary posted on [#671](https://github.com/aibtcdev/landing-page/issues/671#issuecomment-4414012014). Route-level per-row verification arrives with [#684](https://github.com/aibtcdev/landing-page/issues/684).

## Phase 2.x gate satisfaction

The RFC's literal gate text is "produce a diff report; must show zero **unexplained** drift before Phase 2 starts." This document is the diff report. All drift explained by Phase 1.3's design choices. Phase 2.x read flips can begin alongside the path-A pagination work.

For Phase 2.5 (inbox dual-write → flip), the `unreadCount` empirical acceptance test in the reconcile route (see `route.ts` `runUnreadCountAcceptanceTest`) provides the additional row-level verification specifically targeted at the [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497) drift case — independent of the broader pagination refactor.

## Open follow-up

- **Path A (pagination refactor):** Add `?cursor=…&maxKeysPerCall=1000` query params to inbox reconcile, keeping single-call shape for agents/claims/vouches. Cursor in URL/body (stateless route). Filed as separate sub-issue [#684](https://github.com/aibtcdev/landing-page/issues/684).

## Reproducing this baseline

```bash
ADMIN_API_KEY=<admin api key>  # ARC_ADMIN_API_KEY worker secret value; obtain from the maintainer's secret store

# Three tables verified at the route:
for t in agents claims vouches; do
  curl -sS -X POST "https://aibtc.com/api/admin/reconcile?table=$t&sampleSize=50" \
    -H "X-Admin-Key: $ADMIN_API_KEY" | jq '{table, kv_count, d1_count, drift, drift_unexplained, explained_categories}'
done

# D1 row counts:
for t in agents claims inbox_messages vouches; do
  npm run wrangler -- d1 execute landing-page --remote \
    --command "SELECT COUNT(*) AS count FROM $t;"
done
```

## Cross-references

- RFC: `docs/rfc-d1-schema.md` (§1 architectural decisions)
- Phase 1.3 backfill: PR [#672](https://github.com/aibtcdev/landing-page/pull/672) + sub-issue [#671](https://github.com/aibtcdev/landing-page/issues/671) (operational summary in comment)
- Phase 1.4 reconcile: PRs [#678](https://github.com/aibtcdev/landing-page/pull/678) [#680](https://github.com/aibtcdev/landing-page/pull/680) [#681](https://github.com/aibtcdev/landing-page/pull/681) [#682](https://github.com/aibtcdev/landing-page/pull/682) + sub-issue [#675](https://github.com/aibtcdev/landing-page/issues/675)
- Operational backfill summary (in-repo via comment): [#671 — operational backfill complete](https://github.com/aibtcdev/landing-page/issues/671#issuecomment-4414012014)
