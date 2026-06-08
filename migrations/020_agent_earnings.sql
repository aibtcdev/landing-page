-- Migration 020: agent earnings ledger (Phase 1 — schema + indexer core)
--
-- Verified on-chain earnings ledger (issue #978). A cron-driven indexer scans
-- confirmed inbound transfers (sBTC / STX / aeUSDC) to every registered agent
-- STX address, classifies each by counterparty, prices it in USD at index time,
-- and writes an idempotent line-item ledger here.
--
-- Phase 1 scope: agent_earnings (the ledger) + earnings_index_state (per-agent
-- high-water mark). Anti-gaming tables (address_first_funder,
-- earnings_manual_override) land in Phase 2; the agent_earnings.excluded_reason
-- column already exists so Phase 2 can flag rows without a schema change.
--
-- See docs/earnings-ledger-architecture.md.

-- ── The ledger ───────────────────────────────────────────────────────────
-- One row per inbound transfer event. Idempotent on (tx_id, event_index): a
-- single tx can carry multiple FT/STX transfers, each indexed separately.
CREATE TABLE IF NOT EXISTS agent_earnings (
  tx_id               TEXT    NOT NULL,
  event_index         INTEGER NOT NULL DEFAULT 0,
  stx_block_height    INTEGER,
  block_time          INTEGER NOT NULL,            -- unix seconds (burn block time)
  recipient_agent_stx TEXT    NOT NULL,            -- the earner (FK agents.stx_address)
  sender_stx          TEXT    NOT NULL,            -- counterparty
  asset               TEXT    NOT NULL CHECK (asset IN ('sbtc', 'stx', 'aeusdc')),
  amount_raw          INTEGER NOT NULL,            -- base units (sats / microSTX / 1e-6 aeUSDC)
  amount_usd          REAL,                        -- nullable until priced
  price_usd           REAL,
  price_source        TEXT    CHECK (price_source IN ('tenero', 'stablecoin', 'last_good', 'none') OR price_source IS NULL),
  priced_at           INTEGER,
  source_class        TEXT    NOT NULL CHECK (source_class IN (
                        'inbox_message', 'bounty', 'x402_endpoint', 'agent_peer',
                        'exchange_or_external', 'unclassified')),
  source_subclass     TEXT,                        -- e.g. bounty id, inbox message id
  excluded_reason     TEXT    CHECK (excluded_reason IN (
                        'self_funded', 'ring', 'external', 'unclassified', 'excluded_manual')
                        OR excluded_reason IS NULL),
  is_earning          INTEGER NOT NULL DEFAULT 0,  -- derived & stored for fast agg/index
  indexed_at          INTEGER NOT NULL,
  PRIMARY KEY (tx_id, event_index)
);

-- Per-agent rollup window scans (7d/30d/lifetime) and per-agent line-item reads.
CREATE INDEX IF NOT EXISTS idx_agent_earnings_recipient_time
  ON agent_earnings (recipient_agent_stx, block_time);

-- Leaderboard / platform aggregate scans only ever touch earning rows.
CREATE INDEX IF NOT EXISTS idx_agent_earnings_earning_time
  ON agent_earnings (block_time) WHERE is_earning = 1;

-- Review queue for excluded / unclassified rows (Phase 2 tagging).
CREATE INDEX IF NOT EXISTS idx_agent_earnings_excluded
  ON agent_earnings (source_class) WHERE excluded_reason IS NOT NULL;

-- ── Per-agent high-water mark ────────────────────────────────────────────
-- Lets the sweep process only NEW transfers since each agent's last indexed
-- block, so steady-state cost decays to the rate of new on-chain activity.
CREATE TABLE IF NOT EXISTS earnings_index_state (
  agent_stx          TEXT    PRIMARY KEY,
  last_indexed_block INTEGER NOT NULL DEFAULT 0,   -- highest stx block height indexed (incremental frontier)
  backfill_offset    INTEGER NOT NULL DEFAULT 0,   -- pagination offset for the initial history walk
  backfill_complete  INTEGER NOT NULL DEFAULT 0,   -- 1 once the initial history walk finishes
  last_indexed_at    INTEGER
);
