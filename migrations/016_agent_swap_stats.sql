-- Migration 016: agent_swap_stats maintained-counter table.
--
-- Replaces the live `SELECT COUNT(*) FROM swaps WHERE sender = ?` +
-- per-agent aggregate JOIN in `lib/competition/d1-reads.ts` with O(1)
-- point-lookups on this single-row-per-sender table.
--
-- This is the same anti-pattern + same fix shape as migration 012
-- (`agent_inbox_stats`). The cost-driver root-cause is documented in
-- `feedback_d1_count_antipattern`: D1 is pay-per-row-scanned; COUNT(*)
-- and aggregate JOINs over a wide table walk every matching row on
-- every request, even when the route has `s-maxage=10` (the cache
-- expires every 10s for hot agents → D1 hit / 10s / agent).
--
-- Columns:
--   stx_address     — primary key, matches swaps.sender
--   trade_count     — total swaps with this sender
--   verified_count  — subset where tx_status = 'success' (renamed
--                     from "verified_trade_count" in the API for
--                     internal brevity; the API field name is
--                     preserved in lib/competition/d1-reads.ts)
--   first_trade_at  — MIN(burn_block_time) (unix int, matches schema)
--   last_trade_at   — MAX(burn_block_time)
--   updated_at      — ISO-8601 of last counter update
--
-- Write-path maintenance (see lib/competition/stats.ts):
--   On `insertSwap` success (meta.changes === 1):
--     recordSwapInsert(db, sender, burn_block_time, tx_status) UPSERTs
--     with `trade_count = trade_count + 1`, `verified_count = ... + 1
--     when status='success'`, `first/last_trade_at` via MIN/MAX.
--
-- Repair: rebuildSwapStats() in lib/competition/stats.ts recomputes
-- from `swaps` GROUP BY sender. Run after admin mutations to swaps
-- (none exist today, but documented per the inbox_stats pattern).
--
-- Backfill: a one-shot INSERT OR REPLACE seed runs once after the
-- migration applies, populating one row per existing sender. Captured
-- in `phases/P3B/backfill-swap-stats-2026-05-20.sql`.
--
-- Quest: 2026-05-18-kv-d1-pattern-finish, P3B PR 2.

CREATE TABLE IF NOT EXISTS agent_swap_stats (
  stx_address     TEXT PRIMARY KEY,
  trade_count     INTEGER NOT NULL DEFAULT 0,
  verified_count  INTEGER NOT NULL DEFAULT 0,
  first_trade_at  INTEGER,
  last_trade_at   INTEGER,
  updated_at      TEXT NOT NULL
);

-- Atomic seed: populate the new table from every existing sender in
-- one statement, inside the same migration transaction as the CREATE.
-- This closes the correctness window where a deploy applies the
-- migration but the operator hasn't yet run the backfill SQL: without
-- this seed, every historical trader would report trade_count=0 on
-- /api/competition/status and /api/competition/trades until the manual
-- backfill ran (Codex PR #892 P1 feedback).
--
-- INSERT OR REPLACE keeps the seed re-runnable; in normal operation
-- this runs once at migration-apply time and is a no-op thereafter
-- (the maintained write path in lib/competition/stats.ts owns updates
-- from this point forward). The `2026-05-20T06:30:00Z` timestamp is
-- the migration-author time; updated_at gets refreshed on the next
-- recordSwapInsert per sender.
--
-- The standalone phases/P3B/backfill-swap-stats-2026-05-20.sql file
-- remains as an operator artifact for manual repair (e.g. after admin
-- mutations to swaps) and historical reference.
INSERT OR REPLACE INTO agent_swap_stats
  (stx_address, trade_count, verified_count, first_trade_at, last_trade_at, updated_at)
SELECT
  sender                                                     AS stx_address,
  COUNT(*)                                                   AS trade_count,
  SUM(CASE WHEN tx_status = 'success' THEN 1 ELSE 0 END)     AS verified_count,
  MIN(burn_block_time)                                       AS first_trade_at,
  MAX(burn_block_time)                                       AS last_trade_at,
  '2026-05-20T06:30:00Z'                                     AS updated_at
FROM swaps
GROUP BY sender;
