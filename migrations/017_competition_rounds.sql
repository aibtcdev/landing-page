-- Migration 017: competition_rounds, competition_round_price_snapshots,
--               competition_round_results, competition_rewards.
--
-- Adds the four tables needed to freeze a weekly competition snapshot,
-- compute final rankings, and queue per-category reward rows for a
-- downstream payout path to consume.
--
-- Design decisions locked in quest 2026-05-20-competition-snapshot-finalize:
--
-- 1. Three reward categories: overall_pnl (Overall P&L, tiebreak: volume_usd),
--    volume (Volume Champion), return (Return Champion — floor-gated by
--    min_volume_usd and min_priced_trade_count).
--
-- 2. Payout recipient keying: competition_rewards persists BOTH stx_address
--    (snapshot at finalization time) AND erc8004_agent_id (nullable) so the
--    payout path can reference either key without re-querying agents.
--
-- 3. grace_ends_at: 60-minute window after ends_at. NOTE: Stacks blocks are
--    now ~5 s (not 10 min as cited in issue #822), but 60 min is still the
--    correct default — the SchedulerDO fires every ~15 min and the extra
--    margin keeps the close-detection window safe.
--
-- 4. NaN guard: pnl_percent is stored as NULL (not 0.0) when volume_usd = 0.
--    NULL is treated as ineligible for Return Champion; zero-volume agents
--    still appear in P&L and Volume rankings if otherwise qualified.
--
-- 5. result_json type-pin: shape { source_counts: { agent, cron, chainhook },
--    unpriced_tokens: string[] }. See lib/competition/finalize/types.ts for
--    the TS interface and runtime parse helper.
--
-- 6. Status machine includes 'partially_paid' so the payout path can mark
--    individual competition_rewards rows as paid/failed without blocking the
--    round-level status until every reward is settled.
--
-- 7. competition_rewards.created_at column required for consistency with
--    bounties, inbox, and other timestamped tables in this codebase.
--
-- 8. competition_round_price_snapshots.source enum: 'tenero' and
--    'manual_admin'. The 'tenero' value is written by the snapshot helper;
--    'manual_admin' is reserved for operator overrides via the admin route.
--
-- Quest reference: 2026-05-20-competition-snapshot-finalize, Phase 1.
-- Prior competition migrations: 005_swaps, 009_competition_state,
-- 010_swaps_token_indexes, 011_competition_clean_pre_launch, 016_agent_swap_stats.

-- ── 1. competition_rounds ─────────────────────────────────────────────────────
--
-- One row per scored competition window. Drives the state machine:
--   open → closed → finalizing → finalized → (partially_paid →) paid
--
-- min_volume_usd and min_priced_trade_count are the Return Champion floor
-- gates; they are stored per-round so the admin can tighten or loosen them
-- for future rounds without changing code.

CREATE TABLE IF NOT EXISTS competition_rounds (
  round_id               TEXT    PRIMARY KEY,
  starts_at              INTEGER NOT NULL,
  ends_at                INTEGER NOT NULL,
  -- 60-min grace window after ends_at. Stacks blocks are now ~5 s (not
  -- 10 min as cited in issue #822), but 60 min is the right default given
  -- the SchedulerDO ~15 min cadence + safety margin.
  grace_ends_at          INTEGER NOT NULL DEFAULT (ends_at + 3600),
  -- Status machine. 'partially_paid' lets per-row retry proceed without
  -- blocking the round; 'paid' means all rewards rows are settled.
  status                 TEXT    NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','closed','finalizing','finalized','partially_paid','paid')),
  min_volume_usd         REAL    NOT NULL DEFAULT 50.0,
  min_priced_trade_count INTEGER NOT NULL DEFAULT 3,
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- finalized_at is set when status transitions to 'finalized'.
  finalized_at           TEXT
);

-- ── 2. competition_round_price_snapshots ──────────────────────────────────────
--
-- Frozen per-token price at round close. Written once (status: closed →
-- finalizing) and never updated — compute always reads this snapshot, not
-- the live Tenero cache, so results are reproducible after the fact.
--
-- Composite PK (round_id, token_id) enforces one row per token per round.

CREATE TABLE IF NOT EXISTS competition_round_price_snapshots (
  round_id    TEXT NOT NULL REFERENCES competition_rounds(round_id),
  token_id    TEXT NOT NULL,
  price_usd   REAL NOT NULL,
  decimals    INTEGER NOT NULL,
  -- 'tenero' written by snapshot helper; 'manual_admin' for operator overrides.
  source      TEXT NOT NULL CHECK(source IN ('tenero','manual_admin')),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (round_id, token_id)
);

-- ── 3. competition_round_results ──────────────────────────────────────────────
--
-- One row per eligible agent per round. Written atomically by the finalize
-- compute pass (status: finalizing → finalized). Immutable after write —
-- re-finalize requires deleting existing rows first (admin-only).
--
-- pnl_percent is NULLABLE: stored as NULL when volume_usd = 0 (NaN guard —
-- see decision 4 above). NULL rows are ineligible for Return Champion but
-- still rank in Overall P&L (by pnl_usd) and Volume.
--
-- result_json holds the typed { source_counts, unpriced_tokens } blob.
-- See lib/competition/finalize/types.ts:parseResultJson for the deserializer.

CREATE TABLE IF NOT EXISTS competition_round_results (
  round_id            TEXT    NOT NULL REFERENCES competition_rounds(round_id),
  rank                INTEGER NOT NULL,
  stx_address         TEXT    NOT NULL,
  btc_address         TEXT    NOT NULL,
  -- May be null if the agent has not minted an ERC-8004 identity NFT.
  erc8004_agent_id    INTEGER,
  trade_count         INTEGER NOT NULL DEFAULT 0,
  priced_trade_count  INTEGER NOT NULL DEFAULT 0,
  unpriced_trade_count INTEGER NOT NULL DEFAULT 0,
  volume_usd          REAL    NOT NULL DEFAULT 0.0,
  received_usd        REAL    NOT NULL DEFAULT 0.0,
  pnl_usd             REAL    NOT NULL DEFAULT 0.0,
  -- NaN guard: NULL when volume_usd = 0 (division by zero undefined).
  -- Non-NULL agents with volume below floor are still ranked; they are
  -- just excluded from Return Champion eligibility.
  pnl_percent         REAL,
  -- NULL when the agent has no swaps in the window.
  latest_trade_at     INTEGER,
  -- JSON blob: { source_counts: {agent,cron,chainhook}, unpriced_tokens: [] }
  result_json         TEXT    NOT NULL DEFAULT '{}',
  calculated_at       TEXT    NOT NULL,
  PRIMARY KEY (round_id, stx_address)
);

CREATE INDEX IF NOT EXISTS idx_competition_round_results_rank
  ON competition_round_results(round_id, rank);

-- ── 4. competition_rewards ────────────────────────────────────────────────────
--
-- One row per (round_id, category). Written by the finalize pass alongside
-- competition_round_results. Consumed by a separate payout path that moves
-- rows from 'pending' → 'paid' | 'failed' | 'void'.
--
-- stx_address is a snapshot taken at finalization time; it does not update
-- if the agent later changes their wallet. erc8004_agent_id is persisted
-- alongside it so the payout path can use either key (see decision 2).

CREATE TABLE IF NOT EXISTS competition_rewards (
  round_id         TEXT    NOT NULL REFERENCES competition_rounds(round_id),
  category         TEXT    NOT NULL CHECK(category IN ('overall_pnl','volume','return')),
  rank             INTEGER NOT NULL DEFAULT 1,
  -- Snapshot at finalization — immutable.
  stx_address      TEXT    NOT NULL,
  -- Nullable: agent may not have an ERC-8004 identity at finalization time.
  erc8004_agent_id INTEGER,
  amount_sats      INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','paid','failed','void')),
  -- Set when status transitions to 'paid'.
  payout_txid      TEXT,
  paid_at          TEXT,
  notes            TEXT,
  -- Required for consistency with bounties, inbox, and other timestamped tables.
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (round_id, category)
);

CREATE INDEX IF NOT EXISTS idx_competition_rewards_status
  ON competition_rewards(round_id, status);
