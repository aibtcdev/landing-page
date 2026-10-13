-- Migration 023: multi-winner bounty support
--
-- Adds:
--   bounties.max_winners      — how many winners a bounty accepts (default 1)
--   bounties.winner_count     — how many have been accepted so far (denorm)
--   bounties.paid_count       — how many have been paid so far (denorm)
--   bounties.fully_accepted_at — ISO timestamp when winner_count first reached max_winners
--   bounty_winners            — join table: one row per accepted winner
--
-- The denorm counters keep bountyStatus() and statusToSql() join-free (no N+1
-- on list endpoints). The join table is the authoritative record for per-winner
-- state and is read by the detail GET to build the winners[] array.
--
-- Backfills existing single-winner bounties so the new code path is the only
-- path: winner_count=1/paid_count=1 for accepted/paid rows, and a
-- corresponding bounty_winners row so the detail GET can use getWinners().

-- 1. New columns on bounties
ALTER TABLE bounties ADD COLUMN max_winners    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bounties ADD COLUMN winner_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bounties ADD COLUMN paid_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bounties ADD COLUMN fully_accepted_at TEXT;

-- 2. Winner join table
CREATE TABLE IF NOT EXISTS bounty_winners (
  id            TEXT PRIMARY KEY,
  bounty_id     TEXT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES bounty_submissions(id),
  accepted_at   TEXT NOT NULL,
  paid_txid     TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(bounty_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_bounty_winners_bounty ON bounty_winners(bounty_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounty_winners_paid_txid
  ON bounty_winners(paid_txid) WHERE paid_txid IS NOT NULL;

-- 3. Backfill counters for existing rows
UPDATE bounties
SET
  winner_count       = CASE WHEN accepted_submission_id IS NOT NULL THEN 1 ELSE 0 END,
  paid_count         = CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END,
  fully_accepted_at  = CASE WHEN accepted_submission_id IS NOT NULL THEN accepted_at ELSE NULL END
WHERE 1 = 1;

-- 4. Backfill bounty_winners for already-accepted bounties
--
-- NOTE: IDs generated here use `'bw_' || lower(hex(randomblob(8)))` (pure SQL,
-- 16 hex chars of randomness) rather than the runtime format produced by
-- generateWinnerId() (base36 ms timestamp + 12-char UUID slice). The formats
-- differ because the JS runtime is not available inside a migration. Both are
-- unique and opaque to callers; the discrepancy only surfaces when debugging
-- pre-023 winner rows by their ID prefix.
INSERT OR IGNORE INTO bounty_winners (id, bounty_id, submission_id, accepted_at, paid_txid, paid_at, created_at)
SELECT
  'bw_' || lower(hex(randomblob(8))),
  id,
  accepted_submission_id,
  accepted_at,
  paid_txid,
  paid_at,
  COALESCE(accepted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM bounties
WHERE accepted_submission_id IS NOT NULL;
