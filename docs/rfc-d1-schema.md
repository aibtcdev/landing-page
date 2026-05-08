# RFC: landing-page D1 schema

**Status:** Draft — pending review
**Author:** whoabuddy
**Created:** 2026-05-08
**Umbrella:** [#652](https://github.com/aibtcdev/landing-page/issues/652) — pre-erc-8004 simplification + D1 migration
**Closes (on merge):** [#296](https://github.com/aibtcdev/landing-page/issues/296) (D1 evaluation)

## Summary

Replace KV-backed relational data on `aibtcdev/landing-page` with a single Cloudflare D1 database hosting six tables and one view: `agents`, `claims`, `inbox_messages`, `vouches`, `swaps`, `balances`, plus a `registered_wallets` view. The migration ships in Phase 1 (RFC + provisioning + backfill) of the [umbrella quest](https://github.com/aibtcdev/landing-page/issues/652); reads flip route-by-route in Phase 2; trading-comp verifier + dashboard build on the same schema in Phase 3.

This RFC fixes the wrong guidance from [#296](https://github.com/aibtcdev/landing-page/issues/296)'s evaluation (which kept rate limits in KV) and codifies the schema for the post-Phase-0 simplified surface (achievements removed, heartbeat tier counters dropped, rate limits already on Cloudflare `ratelimits` binding).

## Motivation

Pre-Phase-0 KV usage on `VERIFIED_AGENTS` was burning ~$6.64/day on the namespace alone, dominated by:
1. **Rate-limit RMW** on every mutating request — fixed in Phase 0.3 ([#662](https://github.com/aibtcdev/landing-page/pull/662)) by cutover to Cloudflare `ratelimits` binding.
2. **Per-agent fan-out reads on cache rebuilds** — partially fixed in Phase 0.2 ([#656](https://github.com/aibtcdev/landing-page/pull/656)) via mark-stale invalidation; full fix is the D1 migration replacing fan-out reads with a single `SELECT JOIN`.
3. **Eventually-consistent KV reads from anywhere except the write origin** — D1 is single-region but read-strongly-consistent within that region, removing the read-modify-write race that has caused index drift (`unreadCount` discrepancies tracked in [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497)).

Post-#654 / #656 / #658 / #662, the surface area is finally small enough to model in a small relational schema without paving over dead features. Six tables + one view cover the entire relational surface: agents, claims, inbox messages (with replies folded in via `is_reply`), vouches, swaps (Bitflow trading-comp), and balances (per-agent token snapshots). Everything else stays in KV.

## Goals

- Single source of truth for relational reads (agents, claims, inbox/outbox, vouches, swaps, balances).
- Eliminate the KV read-fan-out pattern on hot rebuild paths (`/api/agents`, `/api/leaderboard`, `/api/dashboard`, `/api/agents/{address}`, crawler-bot OG handler).
- Atomic counters via `SELECT COUNT(*)` instead of stored `unreadCount` (closes [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497)).
- Schema covers the full Phase 3 trading-comp surface (verifier writes `swaps`; dashboard reads `agents JOIN balances`) so Phase 3 builds on the same database, not a separate substrate.
- Backfill is one-shot + idempotent; reconciliation is a separate script that diffs D1 vs. KV before Phase 2 read flips.

## Non-goals

- **erc-8004 indexer integration.** Post-quest. Reputation display re-enables as an indexer-native query against the on-chain reputation registry.
- **Generic Stacks indexer extraction with Durable Objects.** Was archived comp-attribution Phase F; deferred to its own quest post-comp.
- **Cross-Worker D1 sharing.** This database is local to landing-page. agent-news / x402-sponsor-relay each get their own (or none) per their own bill-reduction work.
- **Caching layer in front of D1.** D1 is fast enough for the read patterns we're targeting; adding a SWR cache reintroduces the staleness problems we're trying to remove. Edge cache via `Cache-Control` (already in place per route) is sufficient.

## Out of scope (for this RFC, in scope for follow-on PRs)

- **Migration scripts (`001_agents.sql` ... `006_balances.sql`)** — Phase 1.2.
- **Backfill script (KV → D1)** — Phase 1.3.
- **Reconciliation script** — Phase 1.4.
- **Read flips** (Phase 2.1–2.6) and **dual-write cutover for inbox** (Phase 2.5).

## Schema

All tables use `TEXT` for ISO-8601 timestamps and addresses, `INTEGER` for amounts in satoshis (sBTC) or microSTX (STX), `INTEGER` for booleans (`0`/`1`), and `TEXT` for JSON blobs that don't warrant their own columns yet.

### `agents`

Replaces KV pattern `stx:{stxAddress}` and `btc:{btcAddress}` (dual-indexed `AgentRecord`). Referral codes (currently `referral-code:{btcAddress}` + reverse-index `referral-lookup:{CODE}`) are folded in as columns to eliminate the auxiliary KV reads on registration / vouch lookup.

```sql
CREATE TABLE agents (
  btc_address           TEXT PRIMARY KEY,
  stx_address           TEXT NOT NULL UNIQUE,
  stx_public_key        TEXT NOT NULL,
  btc_public_key        TEXT NOT NULL,
  taproot_address       TEXT,
  display_name          TEXT,
  description           TEXT,
  bns_name              TEXT,
  owner                 TEXT,                       -- X (Twitter) handle
  verified_at           TEXT NOT NULL,              -- ISO-8601
  last_active_at        TEXT,
  erc8004_agent_id      INTEGER,
  nostr_public_key      TEXT,
  capabilities_json     TEXT,                       -- JSON array, optional
  last_identity_check   TEXT,
  github_username       TEXT,
  referred_by_btc       TEXT,                       -- BTC address of referrer
  referral_code         TEXT NOT NULL UNIQUE,       -- 6-char code (was referral-code:{btcAddress})
  -- Foreign-key style hint; D1 SQLite enforces FK only when PRAGMA foreign_keys=ON.
  FOREIGN KEY (referred_by_btc) REFERENCES agents(btc_address)
);

CREATE INDEX idx_agents_stx ON agents(stx_address);
CREATE INDEX idx_agents_owner ON agents(lower(owner)) WHERE owner IS NOT NULL;
CREATE INDEX idx_agents_referred_by ON agents(referred_by_btc) WHERE referred_by_btc IS NOT NULL;
CREATE INDEX idx_agents_verified_at ON agents(verified_at);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at) WHERE last_active_at IS NOT NULL;
```

**Notes:**
- `btc_address` is PK because every read path eventually keys on it (BTC is the canonical agent ID); STX address is unique-indexed for STX-keyed lookups.
- `referral_code` is unique-indexed and lives on the row to remove the `referral-lookup:{CODE} → btcAddress` round-trip currently needed during register-with-ref flow.
- `owner` is case-insensitive indexed (lowercase) because handle lookups are case-insensitive in practice.
- `capabilities_json` is a JSON column for forward-compat; not queried directly today, can be normalized later if needed.
- `claim-code:{btcAddress}` (the *one-time-use* claim code, separate from the *referral* code) is **not** folded in here; it lives outside the relational surface (rate-limit-protected, written-once, read-on-redeem only). Stays in KV.

### `claims`

Replaces KV pattern `claim:{btcAddress}` (`ClaimRecord`).

```sql
CREATE TABLE claims (
  btc_address       TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  tweet_url         TEXT NOT NULL,
  tweet_author      TEXT,
  claimed_at        TEXT NOT NULL,
  reward_satoshis   INTEGER NOT NULL DEFAULT 0,
  reward_txid       TEXT,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rewarded', 'failed')),
  FOREIGN KEY (btc_address) REFERENCES agents(btc_address)
);

CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_claimed_at ON claims(claimed_at);
```

**Notes:**
- 1:1 with agents on `btc_address`; PK enforces single claim per agent (matches current `owner:{twitterHandle}` reverse-index invariant on the KV side).
- `status` is a CHECK constraint instead of an enum (D1 SQLite doesn't have native enums); cheap and self-documenting.
- The genesis-payout record (`genesis:{btcAddress}` in KV) is intentionally kept in KV for now — it's an admin-only write path with very low cardinality, and the data shape (`GenesisPayoutRecord`) is small + opaque. Folding it in is a clean follow-on if/when admin tooling wants to query it relationally.

### `inbox_messages`

Replaces KV patterns `inbox:message:{messageId}` (`InboxMessage`) and `inbox:reply:{messageId}` (`OutboxReply`). The two are folded into one table via `is_reply` because outbox replies and inbox messages share most columns and a partial overlap that's easier to model as one row-shape than two cross-referenced tables. Per [#652](https://github.com/aibtcdev/landing-page/issues/652) umbrella decision and PHASES.md.

```sql
CREATE TABLE inbox_messages (
  message_id            TEXT PRIMARY KEY,            -- "msg_{ts}_{uuid}"
  is_reply              INTEGER NOT NULL DEFAULT 0,  -- 0 = inbound message, 1 = outbox reply
  reply_to_message_id   TEXT,                        -- message being replied to (NULL for inbound)
  from_address          TEXT NOT NULL,               -- sender's STX (inbound) or BTC (reply)
  to_btc_address        TEXT NOT NULL,
  to_stx_address        TEXT,                        -- NULL for replies (BTC routing only)
  content               TEXT NOT NULL,
  payment_txid          TEXT,
  payment_satoshis      INTEGER,                     -- NULL for replies (free)
  payment_status        TEXT CHECK (payment_status IN ('confirmed', 'pending') OR payment_status IS NULL),
  payment_id            TEXT,                        -- relay payment identity for staged/confirmed
  receipt_id            TEXT,                        -- relay verify endpoint
  recovered_via_txid    INTEGER NOT NULL DEFAULT 0,  -- 1 if delivered via txid recovery path
  authenticated         INTEGER NOT NULL DEFAULT 0,  -- 1 if BIP-137 verified at submit time
  sender_signature      TEXT,                        -- BIP-137 signature (when present)
  sender_btc_address    TEXT,                        -- recovered from sender_signature
  signature             TEXT,                        -- BIP-137 signature on reply (when is_reply=1)
  sent_at               TEXT NOT NULL,               -- ISO-8601
  read_at               TEXT,                        -- inbound-message-only field
  replied_at            TEXT,                        -- inbound-message-only field
  FOREIGN KEY (to_btc_address) REFERENCES agents(btc_address),
  FOREIGN KEY (reply_to_message_id) REFERENCES inbox_messages(message_id)
);

-- Per-recipient inbox listing (the dominant read pattern)
CREATE INDEX idx_inbox_to_btc_sent_at ON inbox_messages(to_btc_address, sent_at DESC) WHERE is_reply = 0;

-- Per-recipient outbox listing (replies they've sent)
CREATE INDEX idx_inbox_outbox_from_sent_at ON inbox_messages(from_address, sent_at DESC) WHERE is_reply = 1;

-- Unread count per recipient (closes aibtc-mcp-server#497 via live SELECT COUNT(*))
CREATE INDEX idx_inbox_unread ON inbox_messages(to_btc_address) WHERE is_reply = 0 AND read_at IS NULL;

-- Reply chain lookups
CREATE INDEX idx_inbox_reply_to ON inbox_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Txid double-redemption prevention (ALL recovery paths share this lookup)
CREATE UNIQUE INDEX idx_inbox_payment_txid ON inbox_messages(payment_txid) WHERE payment_txid IS NOT NULL;
```

**Notes:**
- The `inbox:agent:{btcAddress}` index (`InboxAgentIndex` with `messageIds` + `unreadCount`) is **eliminated entirely**. `unreadCount` becomes `SELECT COUNT(*) FROM inbox_messages WHERE to_btc_address = ? AND is_reply = 0 AND read_at IS NULL` — atomic, no drift, single round-trip.
- The `inbox:redeemed-txid:{txid}` 90-day double-redemption guard becomes the partial unique index on `payment_txid` (post-merge: any second insert with the same `payment_txid` fails). The `inbox:pending-txid:` negative cache stays in KV (60s TTL — not a relational concern).
- `is_reply = 1` rows have `payment_satoshis = NULL` and `signature` populated; `is_reply = 0` rows have `payment_satoshis NOT NULL` (or recovered via txid) and `signature = NULL`. A CHECK constraint enforcing this is tempting but adds friction during dual-write reconciliation; deferring to application-layer validation.
- `StagedInboxMessage` (the locally-staged record while relay confirmation is pending) is **not** modeled in D1. It lives in KV with a short TTL until relay reaches `confirmed`, at which point a row is written to `inbox_messages`. Keeping the staging buffer out of D1 avoids needing a Phase 2.5 dual-write story for transient state.

### `vouches`

Replaces KV pattern `vouch:{referrerBtc}:{refereeBtc}` (`VouchRecord`). The `vouch:index:{btcAddress}` index becomes a `SELECT WHERE referrer_btc = ?`.

```sql
CREATE TABLE vouches (
  referrer_btc      TEXT NOT NULL,
  referee_btc       TEXT NOT NULL,
  registered_at     TEXT NOT NULL,
  message_sent      INTEGER NOT NULL DEFAULT 0,
  paid_out          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (referrer_btc, referee_btc),
  FOREIGN KEY (referrer_btc) REFERENCES agents(btc_address),
  FOREIGN KEY (referee_btc)  REFERENCES agents(btc_address)
);

CREATE INDEX idx_vouches_referrer ON vouches(referrer_btc, registered_at DESC);
CREATE INDEX idx_vouches_referee ON vouches(referee_btc);
CREATE INDEX idx_vouches_paid_out ON vouches(paid_out, registered_at) WHERE paid_out = 0;
```

**Notes:**
- Composite PK enforces the "referrer can vouch for any agent at most once" invariant.
- The 3-referrals-per-code limit is application-layer (current code enforces it via `getVouchIndex().refereeAddresses.length < 3`); becomes `SELECT COUNT(*) FROM vouches WHERE referrer_btc = ?` post-migration.

### `swaps` — Bitflow trading-comp verifier surface (Phase 3)

Folded from archived `2026-05-08-comp-attribution` quest Phase A. Populated by Phase 3.1 verifier (agent-submit fast-path + chainhook + nightly cron all converge on this table via `(txid)` upsert). Empty until Phase 3 ships; included here so the schema is migration-stable and Phase 3 doesn't fight the substrate.

```sql
CREATE TABLE swaps (
  txid              TEXT PRIMARY KEY,
  sender            TEXT NOT NULL,                 -- STX address
  contract_id       TEXT NOT NULL,                 -- e.g. "SP...xyk-core-v-1-1"
  function_name     TEXT NOT NULL,
  token_in          TEXT NOT NULL,                 -- contract_id of input asset
  token_out         TEXT NOT NULL,                 -- contract_id of output asset
  amount_in         INTEGER NOT NULL,              -- raw on-chain units
  amount_out        INTEGER NOT NULL,
  burn_block_time   INTEGER NOT NULL,              -- unix seconds
  tx_status         TEXT NOT NULL CHECK (tx_status IN ('success', 'abort_by_response', 'abort_by_post_condition', 'dropped_replace_by_fee')),
  scored_value      INTEGER,                       -- comp-scoring numerator, NULL if not scored
  scored_at         TEXT,                          -- when scoring ran
  source            TEXT NOT NULL CHECK (source IN ('agent', 'cron', 'chainhook')),
  raw_event_json    TEXT,                          -- the FT/STX transfer event we parsed (audit trail)
  FOREIGN KEY (sender) REFERENCES agents(stx_address)
);

-- Per-agent swap query (dashboard P&L drill-in)
CREATE INDEX idx_swaps_sender_burn_time ON swaps(sender, burn_block_time DESC);

-- Comp scoring sweeps (find unscored swaps within a comp window)
CREATE INDEX idx_swaps_scored_at ON swaps(scored_at) WHERE scored_at IS NULL;

-- Contract-level analytics
CREATE INDEX idx_swaps_contract_burn_time ON swaps(contract_id, burn_block_time DESC);
```

**Notes:**
- `(txid)` PK is the idempotency boundary: every ingestion source (`source='agent'|'cron'|'chainhook'`) does `INSERT OR IGNORE` on `txid`. First writer wins.
- `raw_event_json` keeps the on-chain audit trail even if scoring logic changes — we can re-score historical swaps without re-fetching from Hiro.
- `tx_status` CHECK lets us record terminal-failure swaps too (for diagnostic dashboards), not just successes.
- `sender` FK to `agents.stx_address` enforces the "swaps belong to registered agents" property at insert time. Verifier checks the registered-wallets view (below) before insert; the FK is belt-and-suspenders.

### `balances` — per-agent token balance snapshots (Phase 3)

Folded from archived comp-attribution quest Phase D. Populated by Phase 3.3 5-minute cron. Replaces #651's on-rebuild fan-out for the trading-comp dashboard.

```sql
CREATE TABLE balances (
  agent_address       TEXT NOT NULL,                -- STX address
  token_id            TEXT NOT NULL,                -- "stx", "sbtc", "btc-l1", or contract_id of SIP-10
  captured_at         TEXT NOT NULL,                -- ISO-8601
  raw_amount          INTEGER NOT NULL,             -- on-chain units
  decimals            INTEGER NOT NULL,             -- for human display
  usd_value           INTEGER,                      -- microUSD (i.e. ×1_000_000), NULL if price-feed unavailable
  source              TEXT NOT NULL,                -- "hiro" | "mempool.space" | "stacks-rpc"
  PRIMARY KEY (agent_address, token_id, captured_at),
  FOREIGN KEY (agent_address) REFERENCES agents(stx_address)
);

-- Dashboard query: latest snapshot per agent per token, ordered by USD value
CREATE INDEX idx_balances_captured_usd_desc ON balances(captured_at, usd_value DESC) WHERE usd_value IS NOT NULL;

-- Per-agent balance history
CREATE INDEX idx_balances_agent_token_time ON balances(agent_address, token_id, captured_at DESC);
```

**Notes:**
- Composite PK `(agent_address, token_id, captured_at)` enforces snapshot-at-most-once-per-window and lets us keep historical snapshots cheaply.
- The 5-min cadence means ~288 rows/agent/day across N tokens; with ~1K agents and ~5 tokens average, ~1.4M rows/day. D1 row limits are 50M (free) / 5B (paid); we have multi-year runway. Snapshot trim via TTL-style `DELETE WHERE captured_at < datetime('now','-90 days')` if the table grows uncomfortably; deferred until needed.
- `usd_value` is microUSD (×1,000,000) integer to keep arithmetic precise; price-feed source is documented in `source` so the dashboard can flag stale-price entries.
- `decimals` is denormalized per row so the dashboard doesn't need a separate `tokens` table; trade-off accepted because the canonical token list is small (<20 active tokens) and decimals don't change.

### `registered_wallets` — view (Phase 3)

A derived view (or join table — implementation choice in 1.2) so the verifier and dashboard share one source of truth on "is this address a registered AIBTC agent." Folded from comp-attribution quest Phase C.

```sql
CREATE VIEW registered_wallets AS
SELECT
  btc_address,
  stx_address,
  taproot_address,
  verified_at,
  last_active_at
FROM agents
WHERE stx_address IS NOT NULL;
```

**Notes:**
- Today this is a thin projection over `agents` — almost a no-op view. Two reasons to define it explicitly:
  1. Phase 3 verifier and Phase 3.4 dashboard both want to filter "swap sender ∈ registered wallets" without joining the full agent record. The view makes that intent explicit.
  2. If Phase 1.2 implementation finds the view costs anything performance-wise on D1 (unlikely — D1 SQLite optimizes simple views inline), it can be promoted to a materialized join table maintained by triggers or by the agent-write path. Application code doesn't change.
- Returning to the gist's nuance: registered-wallet membership today ≡ "row exists in `agents` with non-null `stx_address`". If we later need richer membership (e.g., active-only, BNS-required), the view definition is the only place to update.

## Architecture decisions — explicit callouts

### 1. Rate limits stay in `ratelimits` binding (NOT D1, NOT KV)

[#296](https://github.com/aibtcdev/landing-page/issues/296)'s evaluation said *"keep rate limits in KV — KV's atomic increment is purpose-built for this."* This was wrong. **KV has no atomic increment.** The rate-limit code did read-modify-write, which (a) caused the bill leak that motivates this whole quest, and (b) was racy under concurrency.

Phase 0.3 ([#662](https://github.com/aibtcdev/landing-page/pull/662)) cut over to Cloudflare's first-party `ratelimits` binding. **D1 must not become the new home for rate-limit counters.** `ratelimits` binding is the right substrate: per-colo, atomic, no per-request KV writes. Rate-limit data is ephemeral burst-window state with no analytical or audit value — it does not belong in a relational store.

Mentioning this here so future readers don't try to "consolidate" rate limits into D1 in the name of "fewer substrates."

### 2. Identity / BNS / activity caches stay in KV

These are time-bounded caches with TTL semantics that KV handles natively:
- **BNS lookups** (`lib/identity/kv-cache.ts`): three-state cache (24h confirmed-positive, 7d confirmed-negative, 60s lookup-failed).
- **Identity lookups** (ERC-8004 NFT detection): same three-state pattern.
- **Activity / heartbeat counters** (`checkin:{btcAddress}`, 300s TTL): rate-limit-style state, TTL-driven.

D1 has no native TTL on rows. Implementing TTL via `DELETE WHERE expires_at < datetime('now')` adds a sweep-job dependency we don't want for caches. KV's natural expiration semantics are the right fit.

`caches.default` (Cloudflare's edge cache) layers on top for HTTP-cacheable responses (e.g., agent-list, profile renders) — that's an HTTP-layer concern unaffected by the substrate decision.

### 3. KV has no atomic increment — capture the rule so guidance doesn't drift

For posterity: **Cloudflare KV does not support atomic increment, decrement, or compare-and-swap.** Any pattern that looks like `kv.put(key, kv.get(key) + 1)` is racy. The same applies to "fetch the index, append the message ID, write it back" patterns we used pre-D1.

If you find yourself reaching for an atomic-increment-shaped operation:
- **For burst-window throttling** → Cloudflare `ratelimits` binding.
- **For monotonic counters** → derive on read via `SELECT COUNT(*)` (this is what `unreadCount` becomes post-D1).
- **For sequence numbers** → D1 `INTEGER PRIMARY KEY AUTOINCREMENT`.
- **For exactly-once writes** → D1 unique constraint (this is how `inbox:redeemed-txid` becomes the partial unique index on `payment_txid`).

[`feedback_kv_rate_limits_antipattern.md`](https://github.com/aibtcdev/landing-page/issues/652) (memory in quest tracker) captures the prior incident; this RFC pins the principle into a public doc so future contributors don't re-derive it the hard way.

### 4. Worker region matches highest-traffic origin

D1 is **single-region**. A read from a Worker running in a different region than the D1 instance pays an inter-region round-trip (~10–100ms depending on geography). For latency-sensitive reads (`/api/agents/{address}`, profile SSR, leaderboard) this would noticeably regress vs. KV's globally-replicated reads.

**Action item for Phase 1.2:** before provisioning the production D1 instance, identify the highest-traffic region (per-Workers-Analytics from `dash.cloudflare.com`) and provision D1 in the same region. Document the chosen region in `wrangler.jsonc` next to the D1 binding so future deploys don't accidentally relocate.

If global low-latency reads become important post-launch, options are (in order of effort):
1. Edge-cache hot reads via `caches.default` (already done for some routes).
2. D1 read replicas (in beta as of writing — verify availability before depending on this).
3. Per-region cache layer (KV) for the read path with explicit invalidation hooks; reverts to the pre-D1 stale-read problem and is **not recommended**.

## Migration plan (Phase 1.2 → 1.4 → Phase 2)

| Phase | Goal | Rough shape |
|-------|------|-------------|
| **1.2** | Provision D1 + migrations 001–006 | `wrangler d1 create landing-page`; one migration per table; apply in dev + prod; document chosen region |
| **1.3** | Backfill (KV → D1) | One-shot, idempotent script: scan `agents:index`, for each agent fetch `btc:`, `claim:`, `inbox:agent:` + per-message KV reads, `referral-code:`, `vouch:` records; INSERT into D1 with `INSERT OR IGNORE` for idempotency |
| **1.4** | Reconciliation | Compare row counts + spot-check ~50 random agents; produce a diff report; **must show zero unexplained drift before Phase 2 starts** |
| **2.1** | Flip `rebuildAgentListCache` to D1 | Single `SELECT … JOIN claims … LEFT JOIN inbox_messages` replaces the per-agent fan-out reads |
| **2.2** | Flip `/api/agents/[address]` + SSR profile | Profile read served from D1 |
| **2.3** | Flip middleware crawler-bot OG | OG handler served from D1 |
| **2.4** | Flip `/api/leaderboard` + `/api/og/[address]` | Leaderboard ordering matches; unblocks #651 |
| **2.5** | Inbox/outbox dual-write → reconcile → flip | 1hr dual-write window only on `inbox_messages` (revenue surface); reconcile; flip reads then writes; **closes [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497) via live `SELECT COUNT(*)`** |
| **2.6** | Bounty board reads (conditional) | Move iff shape benefits |
| **3.1–3.4** | Trading-comp verifier + chainhook + balance cron + dashboard | Builds on `swaps`, `balances`, `registered_wallets` |
| **4.x** | Cleanup + KV archival | Read-only archive of migrated KV namespaces (6–24h verify-no-reads), then delete |

Per-PR smoke window + cost-measurement comment per the established pattern from #654/#656/#658/#662.

## Consequences

**Positive:**
- Eliminates the dominant KV write driver (rate-limit + index updates per request).
- Eliminates `unreadCount` drift permanently (closes aibtc-mcp-server#497).
- Single-`SELECT` rebuilds for `/api/agents`, `/api/leaderboard`, `/api/dashboard` — no more per-agent fan-out.
- Trading-comp verifier + dashboard land on a substrate that natively supports the queries they need (no SWR cache layer to drift).
- Schema is small + opinionated: 6 tables + 1 view covers the entire relational surface; everything else stays in KV with clear reasons.

**Negative / trade-offs:**
- **Single-region read latency.** Mitigated by region-matching at provisioning (see Decision 4).
- **Migration risk.** Mitigated by per-PR smoke + reconciliation gate before flipping reads.
- **Inbox dual-write complexity (Phase 2.5).** Required because inbox is the only revenue surface; can't tolerate even brief gaps. Other tables skip dual-write (low write rate, idempotent, covered by reconciliation).
- **Schema lock-in.** D1 migrations are forward-only in practice (rolling back schema changes is painful). Deliberate: getting the schema right upfront is the value of this RFC.

**Non-changes:**
- Rate limits, identity/BNS/activity caches, transient staging records (`StagedInboxMessage`, `inbox:pending-txid`), and one-time-use claim codes all stay in KV. **Each has a documented reason** (Decisions 1, 2; per-table notes).

## Open questions

1. **`registered_wallets` as view vs. join table.** Default is view (Phase 1.2 implementation choice). Opening for reviewer input — if Phase 3 query patterns suggest a maintained join table is better, decide here.
2. **Genesis payouts table.** Currently kept in KV as `genesis:{btcAddress}`. Worth folding into D1 as `genesis_payouts` for admin-tooling queries? Defer to a separate sub-issue if there's appetite.
3. **`balances` retention policy.** Default plan is keep-everything until table size becomes uncomfortable; could ship a 90-day TTL sweep in Phase 3.3 if we want to bound growth proactively.

## References

- Quest umbrella: [aibtcdev/landing-page#652](https://github.com/aibtcdev/landing-page/issues/652)
- Original D1 evaluation: [#296](https://github.com/aibtcdev/landing-page/issues/296) (closes via this RFC's merge — supersedes its rate-limit guidance)
- Closes follow-on bug: [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497) (`unreadCount` drift; closes via Phase 2.5 fix)
- KV rate-limit anti-pattern: agent-news#704 + #705 (the cutover this PR's quest mirrored), [PR #662](https://github.com/aibtcdev/landing-page/pull/662) (the landing-page cutover)
- Comp-attribution synthesis (folded into Phases 3.1–3.4): https://gist.github.com/biwasxyz/54213c1d25b9cacb9a79f0e005cf3260#gistcomment-6140059
- Cloudflare cost runbook: [`docs/cloudflare-cost-runbook.md`](./cloudflare-cost-runbook.md)
- Cloudflare D1 docs: https://developers.cloudflare.com/d1/
- Cloudflare `ratelimits` binding docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
