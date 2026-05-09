-- Migration 005: swaps table.
-- See docs/rfc-d1-schema.md `### `swaps`` section.
-- Bitflow trading-comp verifier surface (Phase 3).
-- Populated by Phase 3.1 verifier; empty until Phase 3 ships.
-- Included now so the schema is migration-stable and Phase 3 doesn't fight the substrate.
--
-- tx_status mirrors the TerminalFailureStatuses in x402-sponsor-relay's
-- stacks-tx-verify.ts plus the success path. Pending/in-flight swaps don't get rows;
-- only terminal states are persisted (one row per terminal txid).
--
-- source: ingestion path that wrote the row (agent-submit / cron / chainhook).
-- All paths use INSERT OR IGNORE on txid for idempotency; first writer wins.

CREATE TABLE swaps (
  txid              TEXT PRIMARY KEY,
  -- sender is the STX address
  sender            TEXT NOT NULL,
  -- contract_id e.g. "SP...xyk-core-v-1-1"
  contract_id       TEXT NOT NULL,
  function_name     TEXT NOT NULL,
  -- token_in/token_out are contract_ids of input/output assets
  token_in          TEXT NOT NULL,
  token_out         TEXT NOT NULL,
  -- amount_in/amount_out are raw on-chain units
  amount_in         INTEGER NOT NULL,
  amount_out        INTEGER NOT NULL,
  -- burn_block_time is unix seconds
  burn_block_time   INTEGER NOT NULL,
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
  -- scored_value is the comp-scoring numerator, NULL if not scored
  scored_value      INTEGER,
  -- scored_at is when scoring ran
  scored_at         TEXT,
  source            TEXT NOT NULL CHECK (source IN ('agent', 'cron', 'chainhook')),
  -- raw_event_json is the FT/STX transfer event parsed (audit trail)
  raw_event_json    TEXT,
  FOREIGN KEY (sender) REFERENCES agents(stx_address)
);

-- Per-agent swap query (dashboard P&L drill-in)
CREATE INDEX idx_swaps_sender_burn_time ON swaps(sender, burn_block_time DESC);

-- Comp scoring sweeps (find unscored swaps within a comp window)
CREATE INDEX idx_swaps_scored_at ON swaps(scored_at) WHERE scored_at IS NULL;

-- Contract-level analytics
CREATE INDEX idx_swaps_contract_burn_time ON swaps(contract_id, burn_block_time DESC);
