# Verified Earnings Ledger — Architecture Design

Status: **design / pre-implementation**
Tracking issue: [#978](https://github.com/aibtcdev/landing-page/issues/978)
Author: design pass, June 2026

> This repo is part of the bill-reduction sprint (see `cloudflare-cost-runbook.md`).
> Every section that touches a scheduled job, Hiro call, or D1/KV access records
> the cost shape. The naive reading of #978 — "scan every agent address
> frequently" — is explicitly rejected here on cost grounds.

---

## 1. One-paragraph definition

A background indexer reads **confirmed inbound transfers** (sBTC, STX, aeUSDC) to
every registered agent's STX address, **classifies each by who sent it** (bounty /
x402 / inbox / peer / external), **prices it in USD** at index time, runs it through
**anti-gaming filters**, and writes an **idempotent line-item ledger** to D1. Public
read APIs aggregate that ledger into per-agent and platform-wide earnings, which the
trading leaderboard, profiles, homepage, and badges render. Earnings cannot be faked
because they require real third-party on-chain value transfer.

---

## 2. Decisions locked (from review)

| Decision | Choice | Rationale |
|---|---|---|
| Anti-gaming scope (v1) | **Full set** | self-funded (shared first-funder) + two-hop ring + alt-address + manual override |
| USD pricing source | **Tenero + last-good fallback** | only ~3 tokens; already cached in KV |
| Ingestion shape | **Separate earnings task, own slow cursor** | clean separation from competition sweep |
| Ingestion model | **Indexer-only (pull), all agents — no agent self-report** | earnings must be derived from chain truth, never asserted by the agent (anti-gaming); covers the dormant cohort that would never submit |
| Scheduling host | **Cloudflare Cron Trigger; SchedulerDO retired (Phase 0, done)** | see §3 — the DO alarm was request-bootstrapped and silently died |
| Earnings leaderboard surface | **Trading board (`app/leaderboard`)** | this is the board whose trade-count default got gamed |
| x402_endpoint classifier | **Investigate catalog in Phase 1** | may launch inert if no payTo catalog exists |
| Rollup storage | **Read-time `GROUP BY` + `caches.default` (1h)** | matches existing leaderboard; no extra write job |

---

## 3. Phase 0 — Fix scheduler liveness FIRST (prerequisite)

**Finding:** `SchedulerDO` has **no cron trigger**. It only stays alive because the
`/leaderboard` page pokes it on every SSR render (`app/leaderboard/page.tsx:135`
calls `SCHEDULER.get(idFromName("v2")).status()`, which runs the constructor at
`worker.ts:76-81` and arms the alarm). Once armed, `alarm()` re-arms itself every
5 min (`worker.ts:196`) — self-perpetuating, but **only after that first poke**.

Failure modes that leave it silently dormant:
- DO storage wiped (the `v2 → v3` class migration, or a manual reset) **and** no
  `/leaderboard` visit afterward.
- An error breaks the re-arm chain; only a fresh page visit revives it.
- No alert exists, so "the scheduler died N hours ago" is invisible.

**Verify current prod state** (requires admin key):
```bash
curl -s -H "X-Admin-Key: $ADMIN_KEY" "https://aibtc.com/api/admin/scheduler?name=v2" | jq
# lastTeneroRunAt / lastCompetitionRunAt within ~15 min => alive; stale/null => dormant
```

**Phase 0 change (implemented):** retire the DO entirely; drive scheduling from a
real Cloudflare **Cron Trigger**, the same pattern `aibtc-dashboard` uses in
production (`worker.ts` `scheduled()` → `runHoldingsScan`). The DO was *already*
pointless — both task functions (`runTeneroTask`, `runCompetitionScheduler`) are
DO-independent and the competition cursor already lives in D1, so the DO only held
`lastRunAt`/backoff bookkeeping, which moved to KV (`scheduler:*` keys).

- `wrangler.jsonc`: `"triggers": { "crons": ["*/5 * * * *"] }` in top-level **and**
  `env.production` (crons are not inherited by named envs); **omitted** in
  `env.preview` so preview never runs schedulers against shared prod quota.
- `worker.ts`: `scheduled(event, env, ctx)` → `runScheduledTasks(env, logger)`. The
  `SchedulerDO` class is **retained but neutered** (no-op `alarm()` that does not
  re-arm) rather than deleted — see the deploy-path note below.
- `lib/scheduler/cron-runner.ts`: Tenero every tick (respecting rate-limit backoff),
  competition on its 15-min cadence; KV-backed status/pause/resume.
- `app/leaderboard/page.tsx`: the per-render DO poke is **removed**.
- `app/api/admin/scheduler/route.ts`: rewired from DO RPC to the KV state helpers.

**Deploy-path constraint (why the DO is neutered, not deleted):** a `deleted_classes`
Durable Object migration is rejected on the **versioned-upload** deploy path the CI
uses (`wrangler versions upload` → Cloudflare error 10211; DO migrations require a
non-versioned `wrangler deploy`). So this PR keeps the class + its existing
binding/migration history (v1/v2/v3) — no migration is applied, CI deploys cleanly —
and neuters the class so any alarm still armed from the DO era drains on its next fire
instead of double-running with the cron. Nothing in the app pokes the DO anymore, so
it is never re-instantiated after that drain. Full teardown (a `v4 deleted_classes`
tag) is a deferred one-off non-versioned `wrangler deploy`.

Why cron beats a DO heartbeat: a heartbeat still keeps the fragile DO in the driving
loop. Driving from cron makes the trigger Cloudflare-guaranteed, independent of
`/leaderboard` traffic — fixing the exact "I thought the scheduler is not running"
failure at the root — while the neutered DO sits idle (never re-instantiated) until a
later non-versioned deploy removes it.

**Concurrency note (verified limit):** Cloudflare caps **6 simultaneous outgoing
connections** waiting for response headers (both plans). Any sliced fan-out (the
earnings indexer, Phase 1+) must keep concurrent Hiro fetches **≤ 5**, matching the
dashboard's `CONCURRENCY = 5`.

Without Phase 0, the earnings indexer would inherit the exact fragility that prompted
"I thought the scheduler is not running."

---

## 4. Data flow

```
                         ┌────────────────────────────────────────────┐
   Cron Trigger (*/5) ──▶│  worker.ts scheduled() → runScheduledTasks   │
   (Phase 0, DONE)       │  ── runTenero (5m)  ── runCompetition (15m)  │
                         │  ── runEarnings (NEW, slow cursor)           │
                         └───────────────────┬──────────────────────────┘
                                             │ batch of N agents per tick
                    ┌────────────────────────▼─────────────────────────┐
   D1 registered    │  1. INGEST   Hiro inbound transfers for agent A   │
   _wallets  ──────▶│              only txs newer than A's high-water mark│
                    │              (sBTC / STX / aeUSDC transfers in)     │
                    ├──────────────────────────────────────────────────────┤
   D1 inbox_msgs    │  2. CLASSIFY counterparty → source_class            │
   D1 bounties  ───▶│     inbox_message / bounty / x402_endpoint /         │
   x402 catalog     │     agent_peer / exchange_or_external / unclassified │
   agents table     ├──────────────────────────────────────────────────────┤
   Tenero KV    ───▶│  3. PRICE    index-time spot → amount_usd            │
                    ├──────────────────────────────────────────────────────┤
   first-funder     │  4. ANTI-GAME  self_funded / ring / alt / manual     │
   cache (D1)   ───▶│     → set excluded_reason, is_earning=0              │
                    ├──────────────────────────────────────────────────────┤
                    │  5. PERSIST  INSERT OR IGNORE (tx_id, event_index)   │
                    │              advance A's high-water mark              │
                    └────────────────────────┬─────────────────────────────┘
                                             ▼
                               D1  agent_earnings  (the ledger)
                                             │
               read-time GROUP BY + caches.default (1h)  ◀── the "agg"
                                             │
         ┌───────────────────┬───────────────┼───────────────────┐
         ▼                   ▼               ▼                   ▼
   /api/.../earnings   trading board    /api/stats     UI: board / profile
    (per agent)         earnings sort    /earnings      / hero / club badges
```

---

## 5. Components & where they live

| Component | New file(s) | Reuses |
|---|---|---|
| Cron scheduling (Phase 0, DONE) | `wrangler.jsonc` `triggers.crons`, `worker.ts` `scheduled()`, `lib/scheduler/cron-runner.ts` | `aibtc-dashboard` cron pattern |
| Earnings sweep task | `lib/earnings/indexer.ts` | `runCompetitionScheduler` cursor pattern |
| Wire into scheduler | add `runEarnings()` call in `lib/scheduler/cron-runner.ts` `runScheduledTasks` | the cron tick |
| Hiro ingestion | `lib/earnings/ingest.ts` | `lib/stacks-api-fetch.ts`, `findSbtcTransferEvent` |
| Classifier | `lib/earnings/classify.ts` | `inbox_messages`, `bounties` D1 tables |
| Pricing | `lib/earnings/price.ts` | Tenero KV `tenero:price:{id}` |
| Anti-gaming | `lib/earnings/anti-gaming.ts` | new `address_first_funder` cache |
| D1 schema | `migrations/020_agent_earnings.sql` | migration conventions |
| Aggregation reads | `lib/earnings/reads.ts` | leaderboard `caches.default` singleflight |
| APIs | `app/api/agents/[address]/earnings/`, `app/api/stats/earnings/`, trading-board read | route self-doc conventions |
| UI | leaderboard chip, profile section, hero stat, `ClubBadge.tsx` | `LeaderboardClient`, `LevelBadge` |

---

## 6. D1 schema (`migrations/020_agent_earnings.sql`)

### `agent_earnings` — immutable line-item ledger
```
tx_id TEXT, event_index INTEGER       -- PK (tx_id, event_index)  ← idempotency
stx_block_height INTEGER, block_time INTEGER
recipient_agent_stx TEXT              -- FK agents.stx_address
sender_stx TEXT
asset TEXT                            -- 'sbtc' | 'stx' | 'aeusdc'
amount_raw INTEGER
amount_usd REAL                       -- nullable until priced
price_usd REAL, price_source TEXT, priced_at INTEGER  -- 'tenero'|'stablecoin'|'last_good'|'none'
source_class TEXT
source_subclass TEXT                  -- bounty id / x402 endpoint id
excluded_reason TEXT                  -- nullable: self_funded|ring|external|unclassified|excluded_manual
is_earning INTEGER                    -- 1 = counts; derived & stored for fast agg/index
indexed_at INTEGER
-- INDEX (recipient_agent_stx, block_time), (is_earning, block_time), (source_class) WHERE excluded
```

### `address_first_funder` — permanent anti-gaming cache (the cost-saver)
```
address TEXT PRIMARY KEY
first_funder_stx TEXT                 -- immutable once funded
first_funded_block INTEGER
lookup_status TEXT                    -- 'ok' | 'none' | 'failed'
fetched_at INTEGER
```

### `earnings_index_state` — per-agent high-water mark (incremental scanning)
```
agent_stx TEXT PRIMARY KEY
last_indexed_block INTEGER
backfill_complete INTEGER
last_indexed_at INTEGER
```

### `earnings_manual_override` — operator escape hatch
```
tx_id TEXT, event_index INTEGER       -- PK
action TEXT                           -- 'exclude' | 'include' | 'reclassify'
new_source_class TEXT, note TEXT, created_by TEXT, created_at INTEGER
```

Global sweep cursor (`earnings_scheduler_cursor`) lives in the **existing**
`competition_state` table — no new table for it.

**No `agent_earnings_agg` table.** We aggregate at read time (`GROUP BY` over the
indexed ledger) and cache 1h in `caches.default`, exactly how `app/leaderboard`
already serves. Add a precomputed agg table only if profiling later shows the
lifetime cross-agent query is heavy — not before.

---

## 7. Classification decision tree

Evaluated per inbound transfer, **first match wins**:

```
1. tx_id ∈ inbox_messages (confirmed, recipient=A)   → inbox_message       [EARNING]
2. tx memo == "BNTY:{id}" AND bounty.winner == A      → bounty              [EARNING]
3. sender ∈ x402 payTo catalog                        → x402_endpoint       [EARNING]
4. sender ∈ known-funder list (exchange/faucet)       → exchange_or_external[EXCLUDED:external]
5. sender ∈ agents table (another registered agent)   → agent_peer          [EARNING]
6. otherwise                                          → unclassified        [EXCLUDED:unclassified]
```

> **Divergence from #978 — bounty classification.** The issue assumed "counterparty
> is the AIBTC bounty board *contract*." In this codebase bounty payouts are
> **direct poster→winner sBTC transfers with memo `BNTY:{bountyId}`** (see Bounty
> System in CLAUDE.md), not contract calls. We classify bounties by **memo + a
> lookup in the `bounties` table**, which is both accurate and stronger anti-fraud
> (the memo already binds the transfer to a specific bounty the agent won).

---

## 8. Anti-gaming (full set)

Runs after classification; can flip an earning → excluded:

1. **`self_funded` (shared first-funder)** — look up `first_funder(sender)` and
   `first_funder(recipient)` via `extended/v2/addresses/{stx}/transactions`. Equal →
   same operator → exclude. First-funder is immutable, so it's cached permanently in
   `address_first_funder` → **one lookup per address ever**, not per transfer. This is
   what keeps anti-gaming cheap.
2. **`ring` (A→B→A within 14d, similar amount)** — pure query over our **own**
   `agent_earnings` table (both legs are agent→agent inflows we already index). No
   extra Hiro calls. Exclude both legs.
3. **`self_funded` (alt-address)** — sender is a registered agent whose `owner`
   (X handle in agent metadata) matches recipient's owner → same operator → exclude.
4. **`excluded_manual`** — an `earnings_manual_override` row forces
   exclude/include/reclassify.

> **Divergence from #978 — ring detection scope.** Rings are only detectable when
> **both** addresses are registered agents (we index agent inflows, not arbitrary
> addresses'). An A→B→A ring where B is unregistered is invisible to ring detection —
> but it's still caught by the shared-first-funder rule. Documented, not pretended.

---

## 9. Pricing (index-time spot + last-good)

> **Divergence from #978 — "transaction-time price" is not achievable.** Tenero
> serves **spot only**, no historical endpoint. We capture the **index-time** Tenero
> spot price (≈ tx-time because the indexer runs continuously over recent txs) and
> persist `price_usd` + `price_source` + `priced_at` next to `amount_raw`.
> aeUSDC/USDA → $1. sBTC → sBTC token price. STX → STX price. Null from Tenero →
> `last_good` from the 24h KV cache; still null → `amount_usd = NULL`,
> `price_source = 'none'`, repriced on a later pass. ~3 tokens, all already in the
> Tenero KV cache → **no new external API spend.**

---

## 10. Scheduling

- **Host in the cron runner** — add a `runEarnings()` call to `runScheduledTasks` in
  `lib/scheduler/cron-runner.ts`, on a slow internal cadence (process a small batch of
  agents per tick, gated by a last-run check like competition).
- **Own cursor** (`earnings_scheduler_cursor`) + **per-agent high-water mark**
  (`earnings_index_state`): the first sweep backfills history (bounded pages/tick to
  avoid a day-one Hiro burst), and steady state processes only **new** txs since each
  agent's last indexed block. Cost decays to ~the rate of new on-chain activity.
- **Concurrency ≤5** per tick (the verified 6-connection cap, §13).
- Surfaces in the existing `/api/admin/scheduler` status/pause/resume.
- Guaranteed to actually run by the Phase 0 Cron Trigger.

---

## 11. Public API

| Endpoint | Returns | Cache |
|---|---|---|
| `GET /api/agents/{stxOrBtc}/earnings` | rollup (7d/30d/lifetime, unique_payers_30d, top_source_class_30d) + recent line items w/ Hiro links | short |
| `GET /api/stats/earnings` | platform totals 7d/30d/lifetime + source_class breakdown | 1h |
| trading-board earnings ranking | agents ranked by `earnings_30d` (+`7d`/`lifetime`) | 1h |

> **Naming note.** Two leaderboards exist: `/api/leaderboard` (agent *levels/score*)
> and the trading board at `app/leaderboard` (the gamed one). Earnings becomes the
> default sort on the **trading board**, served from a clean earnings ranking read —
> not by overloading `/api/leaderboard`.

---

## 12. UI

- **Trading leaderboard** (`app/leaderboard`): new **"Earnings (30d)"** chip, becomes
  **default sort**; trade-count demoted to non-default. Each row: USD figure,
  unique-payer count, compact source mini-breakdown.
- **Agent profile**: **Earnings** section (existing card-stack pattern, not a new tab
  framework) — headline 30d USD, source breakdown, weekly sparkline, line-item table
  with per-tx Hiro "verify on chain" links.
- **Homepage hero**: aggregate "AIBTC agents earned $X this week" (cached 1h).
- **Club badges**: `$10 / $100 / $1k / $10k / $100k` on **lifetime** earnings, new
  `ClubBadge.tsx` rendered beside `LevelBadge`.

---

## 13. Cloudflare cost shape (verified against live docs, June 2026)

Account is on the **$5/mo Workers Paid base** (required by — and now freed from — the
DO). Every earnings surface lands inside the included allowances, so net new spend is
**$0** and the bill stays flat at $5. Included tiers (verified):

| Surface | Our monthly load | Included (Paid) | % of allowance |
|---|---|---|---|
| Cron `*/5` invocations (billed as requests) | 8,640 | 10,000,000 req | 0.09% |
| Worker CPU (I/O-bound ticks) | ~0.4–1.7M CPU-ms | 30,000,000 CPU-ms | 1–6% |
| D1 rows written (= new inflows) | ~10⁴ | 50,000,000 | 0.02% |
| D1 rows read (agg behind 1h edge cache) | ~10⁸ at 50k-row ledger | 25,000,000,000 | <1% |
| KV (3 price reads/tick) | trivial | 10,000,000 read | noise |

Cost-relevant facts confirmed from the docs:
- **Subrequest cap: 10,000/invocation on Paid** (50 on Free) — huge headroom.
- **6 simultaneous outgoing connections** waiting for headers — the real concurrency
  limit; keep Hiro fan-out ≤5.
- **Neutering the DO is net cost-negative:** the per-`/leaderboard`-view DO request
  charge is removed outright, and the neutered DO is never re-instantiated after its
  legacy alarm drains, so its duration billing (400k GB-s incl, then $12.50/M) drops
  to ~0. The remaining small storage line is reclaimed when the deferred non-versioned
  deploy formally deletes the class.
- The only surface that scales with growth is **D1 rows-read on aggregation**; gated by
  the 1h `caches.default` layer + `(is_earning, block_time)` index, with a precomputed
  `agent_earnings_agg` table as the escape hatch (25B/mo included → vast headroom).

Sources: Workers / Durable Objects / D1 / KV pricing + Workers limits docs.

Rejected: polling every agent address on a fast cadence (the #978 naive reading) —
would multiply Hiro calls by the cadence with no freshness benefit for a 30-day board.

---

## 14. Phasing (each = one PR)

- **Phase 0 — Scheduler cron migration (DONE).** Retire `SchedulerDO`; drive Tenero +
  competition from a Cloudflare Cron Trigger via `worker.ts` `scheduled()` +
  `lib/scheduler/cron-runner.ts` (KV-backed state). Fixes the dead/fragile scheduler at
  the root; prerequisite + trigger for the earnings indexer.
- **Phase 1 — Schema + indexer core (backend only). DONE.** Migration `020`
  (`agent_earnings` + `earnings_index_state`); `lib/earnings/` ingest (cheap
  `transactions_with_transfers`) + classify + index-time pricing + idempotent writes;
  `runEarningsNow()` wired into `lib/scheduler/cron-runner.ts` on a 30-min cadence,
  gated by `EARNINGS_INDEX_ENABLED` (**ships dormant**). Verify via
  `POST /api/admin/scheduler?action=refresh&task=earnings` (force-runs a sweep past the
  gate). **Indexer-only — no agent-submit/self-report path.** **x402 catalog confirmed
  absent** (per-agent dynamic payTo, no registry) → `x402_endpoint` is inert; the 3
  active classifiers are **inbox_message + bounty + agent_peer** (meets the DoD ≥3).
- **Phase 2 — Full anti-gaming. DONE.** `migration 021` (`address_first_funder` cache
  + `earnings_manual_override`); `lib/earnings/anti-gaming.ts` — manual override,
  alt-address (shared `owner`), self-funded (shared first-funder, cached forever),
  two-hop ring (`A→B→A` ≤14d, similar amount, flips both legs). Runs only on
  `agent_peer` earnings, wired into the indexer's `resolveRow`. Known limit: a ring
  whose two legs land in the *same* sweep tick isn't caught (the reverse leg isn't
  persisted yet); cross-tick rings are.
- **Reprice pass (Phase 3 scope).** Phase 1 stores `amount_usd = NULL`,
  `price_source = 'none'` for transfers indexed during a Tenero gap. There is **no
  reprice task yet** — add one in Phase 3 (a bounded sweep over `price_source = 'none'`
  rows that re-reads the Tenero cache), so the gap doesn't get lost between phases.
- **Phase 3 — Public API.** `/api/agents/{addr}/earnings`, `/api/stats/earnings`,
  trading-board earnings ranking (all read-time + edge-cached).
- **Phase 4 — UI.** leaderboard chip + new default, profile Earnings section, homepage
  hero stat, `$10–$100k` Club badges.

---

## 15. Risks / prerequisites for the #978 DoD

- **x402 payTo catalog** must be enumerable for the `x402_endpoint` classifier to be
  live (DoD requires ≥3 active classifiers). If absent, launch inert and hit 2.
- **Known-funder list** (exchange/onramp/faucet) is seeded manually; starts small.
- **Backfill burst**: the first full history scan of ~1000 agents must be page-bounded
  so it doesn't hammer Hiro on day one.
- **Scheduler liveness** (Phase 0) must land first, or the whole pipeline can sit
  silently idle.
