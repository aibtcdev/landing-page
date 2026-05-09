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
  -- D1 enforces foreign keys by default (equivalent to PRAGMA foreign_keys=ON).
  -- Cycle is intentional: agents.referred_by_btc → agents.btc_address self-FK.
  FOREIGN KEY (referred_by_btc) REFERENCES agents(btc_address)
);

-- stx_address already has an implicit unique index from the UNIQUE constraint;
-- no separate idx_agents_stx needed.
CREATE INDEX idx_agents_owner ON agents(lower(owner)) WHERE owner IS NOT NULL;
CREATE INDEX idx_agents_referred_by ON agents(referred_by_btc) WHERE referred_by_btc IS NOT NULL;
CREATE INDEX idx_agents_verified_at ON agents(verified_at);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at) WHERE last_active_at IS NOT NULL;
```

**Notes:**
- `btc_address` is PK because every read path eventually keys on it (BTC is the canonical agent ID). `stx_address` is `UNIQUE` for STX-keyed lookups; the implicit unique index that creates is sufficient — no separate `idx_agents_stx` needed.
- `referral_code` is unique-indexed and lives on the row to remove the `referral-lookup:{CODE} → btcAddress` round-trip currently needed during register-with-ref flow.
- `owner` is case-insensitive indexed (lowercase) because handle lookups are case-insensitive in practice.
- `capabilities_json` is a JSON column for forward-compat; not queried directly today, can be normalized later if needed.
- `claim-code:{btcAddress}` (the *one-time-use* claim code, separate from the *referral* code) is **not** folded in here; it lives outside the relational surface (rate-limit-protected, written-once, read-on-redeem only). Stays in KV.

**Scope decision: PartialAgentRecord stays in KV until upgraded.**
`lib/types.ts` defines `PartialAgentRecord` — agents auto-registered during a first response with only Bitcoin credentials, no Stacks credentials. The schema above requires `stx_address` / `stx_public_key` `NOT NULL`, so partial records cannot be represented in `agents`. **Phase 1.3 backfill scope:** insert only **full** `AgentRecord` rows into `agents`. Partial records remain in KV at `btc:{btcAddress}` until the agent completes registration (adds Stacks credentials), at which point Phase 2 write paths upsert them into D1. This avoids modeling a transitional state in the relational schema; it costs one extra KV read on the rare partial-agent profile lookup until the agent upgrades.

**Backfill must generate missing referral codes.**
`/api/register` currently swallows failures from `generateAndStoreReferralCode`, and `/api/referral-code` can lazy-generate later. Some KV records may have no `referral-code:{btcAddress}` entry today. Since `referral_code` is `NOT NULL UNIQUE`, **Phase 1.3 backfill must deterministically generate-and-store missing codes before inserting into D1** (using the same generator + collision-retry that `generateAndStoreReferralCode` uses). This is a backfill-time fix; the lazy-generate path on `/api/referral-code` becomes dead code post-migration and can be removed in Phase 4.x cleanup.

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

Replaces KV patterns `inbox:message:{messageId}` (`InboxMessage`) and `inbox:reply:{messageId}` (`OutboxReply`). The two are folded into one table via `is_reply` because outbox replies and inbox messages share most columns and a partial overlap that's easier to model as one row-shape than two cross-referenced tables. Per [#652](https://github.com/aibtcdev/landing-page/issues/652) umbrella decision.

```sql
CREATE TABLE inbox_messages (
  message_id            TEXT PRIMARY KEY,            -- "msg_{ts}_{uuid}"
  is_reply              INTEGER NOT NULL DEFAULT 0,  -- 0 = inbound message, 1 = outbox reply
  reply_to_message_id   TEXT,                        -- message being replied to (NULL for inbound)
  -- Sender address columns: exactly one is populated per row.
  -- Inbound (is_reply=0) rows have from_stx_address (payer's STX from x402 settlement).
  -- Reply (is_reply=1) rows have from_btc_address (recipient's BTC, BIP-322 signed-in).
  from_stx_address      TEXT,                        -- payer's STX (inbound only)
  from_btc_address      TEXT,                        -- replier's BTC (reply only)
  to_btc_address        TEXT NOT NULL,
  to_stx_address        TEXT,                        -- NULL for replies (BTC routing only)
  content               TEXT NOT NULL,
  payment_txid          TEXT,
  payment_satoshis      INTEGER,                     -- NULL for replies (free)
  -- Payment lifecycle state. Mirrors aibtcdev/x402-sponsor-relay's PaymentStatus
  -- (https://github.com/aibtcdev/x402-sponsor-relay src/services/payment-status.ts)
  -- so the inbox row records the relay's terminal outcome rather than its own
  -- weaker enum. NULL when the row is a reply (no payment) or a fresh inbound
  -- before any settlement step has run.
  payment_status        TEXT CHECK (payment_status IN (
                          'pending',     -- relay accepted, not yet on-chain
                          'confirmed',   -- on-chain success
                          'failed',      -- terminal failure (see payment_terminal_reason)
                          'replaced'     -- RBF/head-bump; agent should resubmit
                        ) OR payment_status IS NULL),
  payment_terminal_reason TEXT,                      -- canonical TerminalReason (mirrors @aibtc/tx-schemas/core)
  payment_error_code    TEXT,                        -- machine-readable (e.g., INSUFFICIENT_FUNDS)
  payment_replacement_txid TEXT,                     -- replacement on-chain txid for RBF tracking
  payment_id            TEXT,                        -- relay payment identity for staged/confirmed
  receipt_id            TEXT,                        -- relay verify endpoint
  recovered_via_txid    INTEGER NOT NULL DEFAULT 0,  -- 1 if delivered via txid recovery path
  authenticated         INTEGER NOT NULL DEFAULT 0,  -- 1 if Bitcoin signature verified at submit time
  -- Single Bitcoin-message-signature column for both inbound and reply paths.
  -- BIP-322 only (segwit addresses: bc1q P2WPKH, bc1p P2TR). Generic column
  -- name accommodates future BIP-340 / Schnorr / taproot signing without a rename.
  -- For inbound rows: signature optionally provided by sender (proves sender_btc_address).
  -- For reply rows: signature on the reply payload (proves from_btc_address).
  bitcoin_signature     TEXT,
  sender_btc_address    TEXT,                        -- recovered from bitcoin_signature on inbound
  sent_at               TEXT NOT NULL,               -- ISO-8601
  read_at               TEXT,                        -- inbound-message-only field
  replied_at            TEXT,                        -- inbound-message-only field
  CHECK (
    (is_reply = 0 AND from_stx_address IS NOT NULL AND from_btc_address IS NULL) OR
    (is_reply = 1 AND from_btc_address IS NOT NULL AND from_stx_address IS NULL)
  ),
  FOREIGN KEY (to_btc_address) REFERENCES agents(btc_address),
  FOREIGN KEY (reply_to_message_id) REFERENCES inbox_messages(message_id)
);

-- Per-recipient inbox listing (the dominant read pattern)
CREATE INDEX idx_inbox_to_btc_sent_at ON inbox_messages(to_btc_address, sent_at DESC) WHERE is_reply = 0;

-- Per-recipient outbox listing (replies they've sent)
CREATE INDEX idx_inbox_outbox_from_btc_sent_at ON inbox_messages(from_btc_address, sent_at DESC) WHERE is_reply = 1;

-- Unread count per recipient (closes aibtc-mcp-server#497 via live SELECT COUNT(*))
CREATE INDEX idx_inbox_unread ON inbox_messages(to_btc_address) WHERE is_reply = 0 AND read_at IS NULL;

-- Reply chain lookups
CREATE INDEX idx_inbox_reply_to ON inbox_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Txid double-redemption prevention (ALL recovery paths share this lookup).
-- This is PERMANENT — see notes below for the deliberate behavior change from KV's 90d TTL.
CREATE UNIQUE INDEX idx_inbox_payment_txid ON inbox_messages(payment_txid) WHERE payment_txid IS NOT NULL;
```

**Notes:**
- **`from_stx_address` + `from_btc_address` (split sender columns).** Per arc0btc's review on PR #665: a single `from_address` column with type-depending-on-`is_reply` is a latent bug surface for application code that forgets to discriminate. Splitting into two nullable columns + a `CHECK` constraint enforcing exactly-one-populated locks in the invariant at the schema level. Costs one extra `NULL` column per row; trivial.
- **Single `bitcoin_signature` column** (was `sender_signature` + `signature`). Both columns held the same shape — Bitcoin message signatures over **BIP-322** (segwit-only: `bc1q` P2WPKH and `bc1p` P2TR addresses). Legacy P2PKH (`1...`) is **not in scope**; if it ever needs to come back, that's an explicit decision documented at the time. Generic column name avoids implying a single-standard limitation and accommodates future **BIP-340 / Schnorr / taproot signing** without another schema migration. Per arc0btc's review: collapsing the two columns reduces "different name, same concept in different modes" confusion.
- **Payment state model mirrors x402-sponsor-relay** (`payment_status` enum + `payment_terminal_reason` + `payment_error_code` + `payment_replacement_txid`). The previous enum (`'confirmed' | 'pending'`) discarded the relay's richer outcome data. Now: `pending` (in flight) / `confirmed` (on-chain success) / `failed` (terminal — populate `payment_terminal_reason` from the canonical `TerminalReason` set in `@aibtc/tx-schemas/core`, plus optional `payment_error_code` like `INSUFFICIENT_FUNDS`) / `replaced` (RBF or head-bump — populate `payment_replacement_txid` so the agent knows the new on-chain identity to track or resubmit against). Source-of-truth for the in-flight detail (`submitted` / `queued` / `broadcasting` / `mempool`) stays in the relay; D1 records the **terminal outcome** plus enough state to reason about replays. Phase 2.5 dual-write reconciliation includes payment-status validation: KV's `inbox:redeemed-txid:` + `inbox:pending-txid:` + `ratelimit:payment-failure:` keys collectively encode this state across multiple namespaces today; the D1 columns consolidate them into one row. Sample query for "how many of today's inbox attempts failed and why":
  ```sql
  SELECT payment_terminal_reason, COUNT(*)
  FROM inbox_messages
  WHERE is_reply = 0 AND payment_status = 'failed' AND sent_at >= datetime('now', '-1 day')
  GROUP BY payment_terminal_reason
  ORDER BY 2 DESC;
  ```
- **`unreadCount` becomes live `SELECT COUNT(*)`.** The `inbox:agent:{btcAddress}` index (`InboxAgentIndex` with `messageIds` + cached `unreadCount`) is **eliminated entirely**. `SELECT COUNT(*) FROM inbox_messages WHERE to_btc_address = ? AND is_reply = 0 AND read_at IS NULL` is served by `idx_inbox_unread` — atomic, no drift, single round-trip. **This closes aibtc-mcp-server#497** independent of which off-by-one branch is the cause of the cached-counter drift (the live count has nothing to drift against). Phase 1.4 reconciliation includes an empirical acceptance test (see Migration plan below).
- **`payment_txid` uniqueness is PERMANENT (deliberate behavior change).** The `inbox:redeemed-txid:{txid}` 90-day KV TTL becomes a forever-unique partial index on `payment_txid`. This is intentional: a 90-day window for re-using a paid txid was a KV-TTL-shaped artifact, not a security requirement. A txid is a one-time on-chain event; permanent uniqueness is the correct model. If we ever need TTL-style behavior again, a separate `redeemed_txids(txid, redeemed_at)` table with a sweep job is the right shape, not relaxing this index. The `inbox:pending-txid:` negative cache (60s TTL) stays in KV — different concern.
- **Application-layer invariants** beyond the `CHECK`: `is_reply = 1` rows have `payment_satoshis = NULL`; `is_reply = 0` rows have `payment_satoshis NOT NULL` (or `recovered_via_txid = 1`). A CHECK enforcing this is tempting but adds friction during Phase 2.5 dual-write reconciliation; deferring to application-layer validation.
- **`StagedInboxMessage` is NOT modeled in D1.** Locally-staged record while relay confirmation is pending; lives in KV with a short TTL until relay reaches `confirmed`, at which point a row is written to `inbox_messages`. Keeping the staging buffer out of D1 avoids needing a Phase 2.5 dual-write story for transient state.
- **Reply-row `message_id` PK convention (`reply_<parentMessageId>` prefix).** KV stores both an inbound message and its reply under the same parent messageId — `inbox:message:{messageId}` for the inbound row and `inbox:reply:{messageId}` for the reply. If both D1 rows used the KV-derived ID directly, they would collide on the `message_id` PK. Reply rows therefore use a synthesized PK: `reply_<parentMessageId>` (e.g. `reply_msg_abc123`). The shared constant `REPLY_D1_PK_PREFIX = "reply_"` and helper `deriveReplyD1Id(parentMessageId)` in `lib/inbox/d1-pk.ts` are the single source of truth for this prefix. Every write path that inserts a reply row (backfill, Phase 2.5 dual-write, future migrations) **must** use `deriveReplyD1Id()` rather than inlining the prefix. Rationale and alternatives considered (separate `outbox_replies` table; denormalize onto parent row; non-PK uniqueness with KV-derived ID) are in [#673](https://github.com/aibtcdev/landing-page/issues/673).

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
  -- Tx terminal status. Pending/in-flight swaps don't get rows yet; only terminal
  -- states are persisted (one row per terminal txid). Set mirrors the
  -- TerminalFailureStatuses in x402-sponsor-relay's stacks-tx-verify.ts +
  -- the success path. Don't add 'pending' here — pending swaps are tracked by
  -- the verifier upstream, not in this table.
  tx_status         TEXT NOT NULL CHECK (tx_status IN (
                      'success',
                      'abort_by_response',
                      'abort_by_post_condition',
                      'dropped_replace_by_fee',
                      'dropped_replace_across_fork',
                      'dropped_too_expensive',
                      'dropped_stale_garbage_collect',
                      'dropped_problematic'
                    )),
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

-- Per-agent balance history (covers BOTH per-agent drill-in AND the dashboard
-- "latest snapshot per agent per token" query — leftmost prefix matches both).
CREATE INDEX idx_balances_agent_token_time ON balances(agent_address, token_id, captured_at DESC);
```

**Notes:**
- Composite PK `(agent_address, token_id, captured_at)` enforces snapshot-at-most-once-per-window and lets us keep historical snapshots cheaply.
- **Single index `idx_balances_agent_token_time` covers both query shapes** — per arc0btc's review, the original `idx_balances_captured_usd_desc(captured_at, usd_value DESC)` doesn't serve the dashboard query (which is shaped `WHERE agent_address = ? AND token_id = ? ORDER BY captured_at DESC LIMIT 1`, or a window function for the cross-agent leaderboard). The agent-token-time index is the right shape for both. Removed the captured_usd_desc index.
- **5-min cadence row growth:** ~288 rows/agent/day across N tokens; ~1K agents × ~5 tokens average ≈ ~1.44M rows/day. The org is on the **Workers Paid ($5/mo) tier**, so D1 limits are well above projected traffic — without a sweep we'd hit row-count concerns on the order of years, not weeks. **Phase 3.3 still ships the 90-day TTL sweep** (per secret-mars's vote on Open Question 3): `DELETE FROM balances WHERE captured_at < datetime('now', '-90 days')`. Three reasons the sweep ships even though we have paid-tier headroom: (a) **SpaceX-5 efficiency** — design tight even when limits are generous, so growth stays predictable for cost modeling and disaster recovery; (b) older snapshots beyond 90 days have no current product use and incur ongoing index-maintenance cost on `idx_balances_agent_token_time`; (c) pre-allocating the sweep with the ingestion cron is cheaper than retrofitting it later (same discipline as the agent-news rate-limit cutover). If the team later wants per-agent retention beyond 90 days, that's a feature ask, not a tier decision.
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
FROM agents;
```

**Notes:**
- Today this is a thin projection over `agents` — almost a no-op view. The previous `WHERE stx_address IS NOT NULL` predicate was a no-op because `agents.stx_address` is `NOT NULL` (per the partial-agent scope decision: partial records stay in KV until upgraded). Predicate removed.
- Two reasons to define the view explicitly:
  1. Phase 3 verifier and Phase 3.4 dashboard both want to filter "swap sender ∈ registered wallets" without joining the full agent record. The view makes that intent explicit.
  2. If Phase 1.2 implementation finds the view costs anything performance-wise on D1 (unlikely — D1 SQLite optimizes simple views inline), it can be promoted to a materialized join table maintained by triggers or by the agent-write path. Application code doesn't change.
- Returning to the gist's nuance: registered-wallet membership today ≡ "row exists in `agents`". If we later need richer membership (e.g., active-only, BNS-required, partial-agents-once-supported), the view definition is the only place to update.

## Architecture decisions — explicit callouts

### 1. Rate limits stay in `ratelimits` binding (NOT D1, NOT KV)

[#296](https://github.com/aibtcdev/landing-page/issues/296)'s evaluation said *"keep rate limits in KV — KV's atomic increment is purpose-built for this."* This was wrong. **KV has no atomic increment.** The rate-limit code did read-modify-write, which (a) caused the bill leak that motivates this whole quest, and (b) was racy under concurrency.

Phase 0.3 ([#662](https://github.com/aibtcdev/landing-page/pull/662)) cut over to Cloudflare's first-party `ratelimits` binding. **D1 must not become the new home for rate-limit counters.** `ratelimits` binding is the right substrate: per-colo, atomic, no per-request KV writes. Rate-limit data is ephemeral burst-window state with no analytical or audit value — it does not belong in a relational store.

Mentioning this here so future readers don't try to "consolidate" rate limits into D1 in the name of "fewer substrates."

### 2. Identity / BNS / activity caches stay in KV

These are time-bounded caches with TTL semantics that KV handles natively:
- **BNS lookups** (`lib/identity/kv-cache.ts`): three-state cache (24h confirmed-positive, 7d confirmed-negative, 60s lookup-failed).
- **Identity lookups** (ERC-8004 NFT detection): same three-state pattern.
- **Activity / heartbeat record** (`checkin:{btcAddress}`): persistent KV key written via `kv.put(...)` without `expirationTtl`, overwritten on each check-in. Acts as the per-agent latest-activity marker plus the rate-limit gate (`/api/heartbeat` POST checks the stored timestamp's age before accepting a new check-in). **No TTL today** — the value just gets overwritten each call.

D1 has no native TTL on rows. Implementing TTL via `DELETE WHERE expires_at < datetime('now')` adds a sweep-job dependency we don't want for caches. KV's natural expiration semantics (where they exist) are the right fit; for keys like `checkin:{btcAddress}` that don't use TTL today, the persistent overwritten-on-each-call pattern is fine and doesn't need migration.

`caches.default` (Cloudflare's edge cache) layers on top for HTTP-cacheable responses (e.g., agent-list, profile renders) — that's an HTTP-layer concern unaffected by the substrate decision.

### 3. KV has no atomic increment — capture the rule so guidance doesn't drift

For posterity: **Cloudflare KV does not support atomic increment, decrement, or compare-and-swap.** Any pattern that looks like `kv.put(key, kv.get(key) + 1)` is racy. The same applies to "fetch the index, append the message ID, write it back" patterns we used pre-D1.

If you find yourself reaching for an atomic-increment-shaped operation:
- **For burst-window throttling** → Cloudflare `ratelimits` binding.
- **For monotonic counters** → derive on read via `SELECT COUNT(*)` (this is what `unreadCount` becomes post-D1).
- **For sequence numbers** → D1 `INTEGER PRIMARY KEY AUTOINCREMENT`.
- **For exactly-once writes** → D1 unique constraint (this is how `inbox:redeemed-txid` becomes the partial unique index on `payment_txid`).

The principle: KV's read-then-write rate-limit pattern caused the per-request bill leak that motivated this whole quest. Cloudflare `ratelimits` binding is the durable fix. D1 must not become its replacement — neither for rate-limit counters nor for any pattern that wants atomic-increment semantics. (Captured in the off-repo quest-tracker memory and pinned here in a public doc so future contributors don't re-derive the lesson the hard way.)

### 4. Worker region matches highest-traffic origin → **us-west** (`wnam`)

D1 is **single-region**. A read from a Worker running in a different region than the D1 instance pays an inter-region round-trip (~10–100ms depending on geography). For latency-sensitive reads (`/api/agents/{address}`, profile SSR, leaderboard) this would noticeably regress vs. KV's globally-replicated reads.

**Decision for Phase 1.2:** provision the production D1 instance in **us-west** (Cloudflare region hint `wnam`) — matches the highest-traffic Worker region per maintainer (whoabuddy). Document the chosen region in `wrangler.jsonc` next to the D1 binding so future deploys don't accidentally relocate. Cloudflare D1 region selection at create time uses the `--location` flag: `wrangler d1 create landing-page --location wnam`.

If global low-latency reads become important post-launch, options are (in order of effort):
1. Edge-cache hot reads via `caches.default` (already done for some routes).
2. D1 read replicas (in beta as of writing — verify availability before depending on this).
3. Per-region cache layer (KV) for the read path with explicit invalidation hooks; reverts to the pre-D1 stale-read problem and is **not recommended**.

### 6. Workers Paid ($5/mo) tier — design tight despite generous headroom

The org is on **Workers Paid** at the $5/mo tier. D1 limits at this tier are well above projected traffic — `balances` row growth (~1.44M rows/day) hits row-count concerns on the order of years, not weeks. KV reads/writes likewise have material headroom post-Phase-0 cutover.

**Design discipline (SpaceX-5 efficiency):** even with generous limits, the schema and operational plan are scoped to be *tight*:
- 6 tables + 1 view cover the entire relational surface; no speculative tables.
- 90-day TTL sweep on `balances` (Phase 3.3) keeps DB size predictable for cost modeling.
- Each architecture decision (1–5) explicitly says what stays in KV / `ratelimits` binding so D1 doesn't accumulate things that don't belong.
- Per-PR cost-measurement comments per the established Phase 0 pattern (#654/#656/#658/#662/#664/#666) keep visibility on actual usage relative to projection.

If actual usage diverges from projection by >2x in either direction (cheaper or more expensive), that's a checkpoint trigger per the quest LOOP_PROMPT — model is wrong, revisit before scaling further.

### 5. Payment state model mirrors x402-sponsor-relay; terminal outcomes only

`inbox_messages.payment_status` mirrors the **terminal subset** of `aibtcdev/x402-sponsor-relay`'s `PaymentStatus` (defined in `src/services/payment-status.ts`). The relay tracks the full lifecycle (`submitted` → `queued` → `broadcasting` → `mempool` → `confirmed`/`failed`/`replaced`) inside its own KV records (24h TTL); D1 records only the **terminal outcome** plus enough metadata to act on replays:

| Relay state | Persisted to inbox_messages? |
|-------------|------------------------------|
| `submitted` | No — transient pre-broadcast |
| `queued` | No — relay-internal |
| `broadcasting` | No — relay-internal |
| `mempool` | Yes (`pending`) — first observable on-chain step |
| `confirmed` | Yes (`confirmed`) |
| `failed` | Yes (`failed`) — populate `payment_terminal_reason` + optional `payment_error_code` |
| `replaced` | Yes (`replaced`) — populate `payment_replacement_txid` so agents know which on-chain id to track |

`TerminalReason` values come from the canonical `@aibtc/tx-schemas/core` enum (the same set the relay populates). Recording the relay's reason verbatim means the inbox table is a faithful audit trail of payment outcomes without duplicating the in-flight queue model.

**Why this matters for migration:** today the same state is encoded across three KV namespaces (`inbox:redeemed-txid:`, `inbox:pending-txid:`, `ratelimit:payment-failure:`) plus the relay's own KV. Phase 2.5 reconciliation collapses all of this into the row's `payment_status` + companion columns, so future debug of "why did this message fail" is a single `SELECT *`, not a multi-namespace KV scan.

## Migration plan (Phase 1.2 → 1.4 → Phase 2)

| Phase | Goal | Rough shape |
|-------|------|-------------|
| **1.2** | Provision D1 + migrations 001–006 | `wrangler d1 create landing-page`; one migration per table; apply in dev + prod; document chosen region |
| **1.3** | Backfill (KV → D1) | One-shot, idempotent script: scan `agents:index`, for each agent fetch `btc:`, `claim:`, `inbox:agent:` + per-message KV reads, `referral-code:`, `vouch:` records; INSERT into D1 with `INSERT OR IGNORE` for idempotency |
| **1.4** | Reconciliation | Compare row counts + spot-check ~50 random agents; produce a diff report; **must show zero unexplained drift before Phase 2 starts**. **Plus an empirical `unreadCount` drift acceptance test** (per @secret-mars's #497 scout): pick 3+ addresses with non-zero unread state; verify `cached_unreadCount == SELECT COUNT(*)` post-flip. If drift is non-zero post-flip, the off-by-one isn't in the cached counter and the read-flip didn't close #497 — failure mode is detectable. |
| **2.1** | Flip `rebuildAgentListCache` to D1 | Single `SELECT … JOIN claims … LEFT JOIN inbox_messages` replaces the per-agent fan-out reads |
| **2.2** | Flip `/api/agents/[address]` + SSR profile | Profile read served from D1 |
| **2.3** | Flip middleware crawler-bot OG | OG handler served from D1 |
| **2.4** | Flip `/api/leaderboard` + `/api/og/[address]` | Leaderboard ordering matches; unblocks #651 |
| **2.5** | Inbox **AND outbox-reply** dual-write → reconcile → flip | **Both write paths** (`inbox:message:` and `inbox:reply:`) get dual-writes during the same 1hr window; reconcile both KV → D1; flip reads then writes. Reply velocity is much lower than inbox-write velocity, so the reply reconciliation surface is naturally smaller, but the implementation should make the reply-write dual-write explicit so a reviewer can verify it didn't get skipped. **Closes [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497) via live `SELECT COUNT(*)`** (validated by Phase 1.4's empirical drift test). **1hr window justification:** based on agent-news#704 cutover precedent (similar inbox-write velocity, no missed events in window); will extend to 6–24hr dual-write only if Phase 2.5 smoke shows divergence between KV and D1 row counts. |
| **2.6** | Bounty board reads (conditional) | Move iff shape benefits |
| **3.1–3.4** | Trading-comp verifier + chainhook + balance cron + dashboard | Builds on `swaps`, `balances`, `registered_wallets`. **3.3 cron ships with a 90-day TTL sweep** (`DELETE FROM balances WHERE captured_at < datetime('now', '-90 days')`) so DB size stays predictable per SpaceX-5 efficiency framing — see `balances` notes and Decision 6. |
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

## Open questions — resolved post-review

The three questions opened in the draft RFC have all been resolved by the dev-council review on PR #665 (@arc0btc + @secret-mars both approved, with concurring votes on each question).

1. **`registered_wallets` as view vs. join table → VIEW.** Both reviewers concur. The `swaps.sender → agents.stx_address` FK already enforces the registered-agent membership invariant at insert time; the view is documentation of intent, not enforcement. Promotion to a maintained join table can come later if a Phase 3 query pattern measurably benefits — D1 SQLite optimizes simple views inline so there's no perf cost today.

2. **Genesis payouts table → DEFER.** Both reviewers concur. Low cardinality, admin-only writes, no relational query pressure. Folding `genesis:{btcAddress}` into D1 adds a table that doesn't serve the main migration goals. File a separate sub-issue if/when admin tooling later wants relational queries on payouts.

3. **`balances` retention policy → SHIP 90-DAY TTL SWEEP WITH PHASE 3.3 CRON** (per @secret-mars's vote). Originally framed as "keep us in D1 free tier"; with the org on Workers Paid ($5/mo), the row-count math gives years of runway without a sweep. The sweep ships anyway under SpaceX-5 efficiency framing (Decision 6): design tight even with generous limits, because predictable DB size protects cost modeling and DR. Sweep: `DELETE FROM balances WHERE captured_at < datetime('now', '-90 days')`. Codified in the `balances` notes and Phase 3 migration row.

## References

- Quest umbrella: [aibtcdev/landing-page#652](https://github.com/aibtcdev/landing-page/issues/652)
- Original D1 evaluation: [#296](https://github.com/aibtcdev/landing-page/issues/296) (closes via this RFC's merge — supersedes its rate-limit guidance)
- Closes follow-on bug: [aibtc-mcp-server#497](https://github.com/aibtcdev/aibtc-mcp-server/issues/497) (`unreadCount` drift; closes via Phase 2.5 fix)
- KV rate-limit anti-pattern: agent-news#704 + #705 (the cutover this PR's quest mirrored), [PR #662](https://github.com/aibtcdev/landing-page/pull/662) (the landing-page cutover)
- Comp-attribution synthesis (folded into Phases 3.1–3.4): https://gist.github.com/biwasxyz/54213c1d25b9cacb9a79f0e005cf3260#gistcomment-6140059
- Cloudflare cost runbook: [`docs/cloudflare-cost-runbook.md`](./cloudflare-cost-runbook.md)
- Cloudflare D1 docs: https://developers.cloudflare.com/d1/
- Cloudflare `ratelimits` binding docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
