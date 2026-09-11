-- Migration 028: legion_events
--
-- Raw print events from the El Salvador legion contracts
-- (elsalvador-yes-legion-v2 and elsalvador-no-legion-v2), delivered by a Hiro
-- Chainhooks 2.0 hook to POST /api/legions/chainhook. The events are the source
-- of truth: proposals, tallies, members and the activity wire are folded from
-- them on read (lib/legion/state.ts). Idempotent by (txid, event_index), so a
-- redelivered or replayed block cannot duplicate a row, and a duplicated `vote`
-- cannot double-count a ballot.
--
-- Replaces the cron-built legion_snapshot / legion_snapshots tables (023, 024).
-- Their writer and readers were removed with the old testnet Legion registry;
-- the tables are left in place and nothing reads or writes them any more.

CREATE TABLE IF NOT EXISTS legion_events (
  txid          TEXT    NOT NULL,
  event_index   INTEGER NOT NULL,
  contract_id   TEXT    NOT NULL,
  proposal_id   INTEGER,
  block_height  INTEGER NOT NULL,
  block_time    INTEGER,
  event         TEXT    NOT NULL,
  payload       TEXT    NOT NULL,
  recorded_at   INTEGER NOT NULL,
  PRIMARY KEY (txid, event_index)
);

-- The one hot read: WHERE contract_id IN (yes, no)
-- ORDER BY block_height DESC, event_index DESC. Index-ordered, so no scan and
-- no sort.
CREATE INDEX IF NOT EXISTS idx_legion_events_contract
  ON legion_events (contract_id, block_height DESC, event_index DESC);
