-- Migration 021: earnings anti-gaming (issue #978, Phase 2)
--
-- Adds the two tables the anti-gaming heuristics need on top of the Phase 1
-- ledger. The agent_earnings.excluded_reason column already exists (migration
-- 020), so flagging a row is a data change, not a schema change.
--
-- See docs/earnings-ledger-architecture.md §8.

-- ── First-funder cache (the cost-saver) ──────────────────────────────────
-- The "who first funded this address" lookup is immutable once an address is
-- funded, so it's cached forever and costs at most a couple of Hiro calls per
-- address EVER (not per transfer). self_funded exclusion compares the first
-- funder of the sender vs the recipient.
CREATE TABLE IF NOT EXISTS address_first_funder (
  address           TEXT PRIMARY KEY,
  first_funder_stx  TEXT,                 -- nullable: 'none' lookups store NULL
  first_funded_block INTEGER,
  lookup_status     TEXT NOT NULL CHECK (lookup_status IN ('ok', 'none', 'failed')),
  fetched_at        INTEGER NOT NULL
);

-- ── Operator override (escape hatch for heuristic misses) ─────────────────
-- Keyed on a ledger line item. `action` forces the row's earning status or a
-- reclassification, regardless of what the heuristics decided.
CREATE TABLE IF NOT EXISTS earnings_manual_override (
  tx_id            TEXT    NOT NULL,
  event_index      INTEGER NOT NULL DEFAULT 0,
  action           TEXT    NOT NULL CHECK (action IN ('exclude', 'include', 'reclassify')),
  new_source_class TEXT,                  -- required when action = 'reclassify'
  note             TEXT,
  created_by       TEXT,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (tx_id, event_index)
);
