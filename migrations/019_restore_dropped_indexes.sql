-- Migration 019: restore indexes silently dropped by migration 008.
--
-- ROOT CAUSE (2026-05-26 D1 attribution): migration 008 (nullable_btc_public_key)
-- rebuilt agents/claims/inbox_messages/vouches/swaps/balances to drop a NOT NULL
-- constraint. SQLite cannot ALTER COLUMN, so 008 did the table-rebuild dance:
--   CREATE TEMP TABLE tmp_x AS SELECT * FROM x; DROP TABLE x; CREATE TABLE x (...);
--   INSERT INTO x SELECT * FROM tmp_x;
-- DROP TABLE removes a table's indexes along with it. Migration 008 recreated
-- ONLY the `agents` indexes afterward (008 lines 254-257) and never restored the
-- indexes defined in migrations 002-006 for the other five rebuilt tables.
--
-- IMPACT: every inbox listing became a full table scan. `wrangler d1 insights`
-- showed inbox_messages SELECTs accounting for ~96% of all D1 rows-read
-- (~4.5B rows/day, ~$100+/mo overage) at <1K agents. EXPLAIN QUERY PLAN confirmed
-- `SCAN inbox_messages` + temp B-tree sort because idx_inbox_to_btc_sent_at and
-- idx_inbox_reply_to were absent from the live DB. The indexes existed in the
-- migration *files* but not in production (`wrangler d1 migrations list` reported
-- "No migrations to apply"), so the prior cost campaign trusted the files and
-- never ran EXPLAIN / checked live sqlite_master.
--
-- This migration is additive and idempotent (IF NOT EXISTS) — it only recreates
-- the indexes 008 dropped. DDL is copied verbatim from migrations 002-006, with
-- one deliberate change noted below.
--
-- NOTE on idx_inbox_payment_txid: originally a UNIQUE index (003 line 86). The
-- live table accumulated 16 duplicate payment_txid groups while the unique
-- constraint was absent (008 onward), so it is recreated here as NON-UNIQUE to
-- keep this migration safe and unblocked. Restoring uniqueness requires a
-- separate dedup data task — see follow-up issue. The non-unique index still
-- serves payment_txid reconciliation lookups; it is not on the hot path.

-- ── inbox_messages (the dominant cost driver) ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inbox_to_btc_sent_at
  ON inbox_messages(to_btc_address, sent_at DESC) WHERE is_reply = 0;
CREATE INDEX IF NOT EXISTS idx_inbox_outbox_from_btc_sent_at
  ON inbox_messages(from_btc_address, sent_at DESC) WHERE is_reply = 1;
CREATE INDEX IF NOT EXISTS idx_inbox_unread
  ON inbox_messages(to_btc_address) WHERE is_reply = 0 AND read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_reply_to
  ON inbox_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
-- NON-UNIQUE (see note above; was UNIQUE in migration 003).
CREATE INDEX IF NOT EXISTS idx_inbox_payment_txid
  ON inbox_messages(payment_txid) WHERE payment_txid IS NOT NULL;

-- ── claims ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_claimed_at ON claims(claimed_at);

-- ── vouches ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vouches_referrer ON vouches(referrer_btc, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouches_referee ON vouches(referee_btc);
CREATE INDEX IF NOT EXISTS idx_vouches_paid_out ON vouches(paid_out, registered_at) WHERE paid_out = 0;

-- ── balances ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_balances_agent_token_time
  ON balances(agent_address, token_id, captured_at DESC);

-- ── swaps (010 added the token_in/out indexes; these three from 005 were not) ─
CREATE INDEX IF NOT EXISTS idx_swaps_sender_burn_time ON swaps(sender, burn_block_time DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_scored_at ON swaps(scored_at) WHERE scored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_swaps_contract_burn_time ON swaps(contract_id, burn_block_time DESC);
