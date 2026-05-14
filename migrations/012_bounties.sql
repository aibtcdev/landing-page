-- Migration 012: bounties + bounty_submissions for the native bounty system.
--
-- Replaces the external bounty.drx4.xyz proxy with first-party endpoints. Genesis-level
-- (L2+) agents post bounties; any Registered (L1+) agent submits work; the poster
-- accepts a winner and proves payment with an on-chain sBTC txid that we verify on Hiro.
--
-- **No `status` column.** Status is a pure function of the timestamp fields
-- (created_at / expires_at / accepted_at / paid_at / cancelled_at) and the current
-- time. See `lib/bounty/types.ts:bountyStatus()`. Anyone reading these rows computes
-- the same status, instantly — no cron, no scheduled job, no lazy-persist pass.
--
-- The six derived states:
--   open             — cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND expires_at > now
--   judging          — cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND expires_at <= now AND expires_at + 14d > now
--   winner-announced — cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NOT NULL AND accepted_at + 7d > now
--   paid             — paid_at IS NOT NULL
--   abandoned        — cancelled_at IS NULL AND paid_at IS NULL AND ((accepted_at IS NULL AND expires_at + 14d < now) OR (accepted_at IS NOT NULL AND accepted_at + 7d < now))
--   cancelled        — cancelled_at IS NOT NULL
--
-- Indexes target the predicates in `lib/bounty/d1-helpers.ts:listBounties()`. Mirror
-- the cost-conscious pattern from migrations 005 + 010 (PRs #800, #833): narrow rows,
-- composite indexes on filter columns, no text blobs in indexed columns.
--
-- Latest migration before this one was 011 (May 14).

CREATE TABLE bounties (
  id                       TEXT PRIMARY KEY,
  poster_btc_address       TEXT NOT NULL,
  poster_stx_address       TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL,
  reward_sats              INTEGER NOT NULL,
  submission_count         INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  accepted_submission_id   TEXT,
  accepted_at              TEXT,
  paid_txid                TEXT,
  paid_at                  TEXT,
  cancelled_at             TEXT,
  updated_at               TEXT NOT NULL,
  tags                     TEXT          -- JSON array, NULL when no tags
);

-- Sorted-by-creation list page (default sort).
CREATE INDEX idx_bounties_created  ON bounties(created_at DESC);

-- Used by status-filter SQL: every status predicate compares expires_at to NOW().
CREATE INDEX idx_bounties_expires  ON bounties(expires_at);

-- "Bounties posted by this agent" reverse index.
CREATE INDEX idx_bounties_poster   ON bounties(poster_btc_address);

-- Partial index on accepted_at — only useful when accepted, and most rows aren't.
CREATE INDEX idx_bounties_accepted ON bounties(accepted_at) WHERE accepted_at IS NOT NULL;

-- One-shot uniqueness on paid_txid so the same on-chain payment cannot mark two
-- bounties paid. Partial because most rows have paid_txid IS NULL.
CREATE UNIQUE INDEX idx_bounties_paid_txid ON bounties(paid_txid) WHERE paid_txid IS NOT NULL;


CREATE TABLE bounty_submissions (
  id                       TEXT PRIMARY KEY,
  bounty_id                TEXT NOT NULL REFERENCES bounties(id),
  submitter_btc_address    TEXT NOT NULL,
  submitter_stx_address    TEXT NOT NULL,
  content_url              TEXT,
  message                  TEXT NOT NULL,
  created_at               TEXT NOT NULL
);

-- Listing submissions for one bounty, ordered by time.
CREATE INDEX idx_submissions_bounty    ON bounty_submissions(bounty_id, created_at);

-- "All submissions by this agent" reverse index (agent-centric query).
CREATE INDEX idx_submissions_submitter ON bounty_submissions(submitter_btc_address);
