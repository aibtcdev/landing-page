-- Migration 032: team submissions for bounties
--
-- Up to 5 registered agents can enter one submission together. The lead
-- submits and names teammates; each teammate confirms with their own
-- signature. The reward is split evenly and the poster pays every member
-- directly, so no member depends on the lead to pass a share on. The bounty
-- is `paid` only once every member's own transfer has been verified.
--
-- Every submission has member rows; a solo submission is a team of one, so
-- reads and the payout check follow a single path.
--
-- share_sats is fixed at submit time: floor(reward_sats / team size), with
-- the remainder going to the lead. The team size is the number of member rows.
--
-- Only CONFIRMED memberships count as an entry. A lead can name any agent as a
-- teammate, so an unconfirmed invite must never lock that agent out of the
-- bounty: they can still submit their own entry or confirm another team, and
-- confirming a second entry on the same bounty is refused.
--
-- After deploying the code, run scripts/bounty-teams-post-deploy-backfill.sql
-- once: it repeats this backfill for rows the old code wrote in between.
--
-- Backfilled rows are `legacy = 1`. Prod has older duplicate entries
-- (one agent, two submissions on one bounty) from before the one-entry rule,
-- so the one-entry-per-agent unique index covers new rows only. The submit
-- and confirm routes still check every row.

CREATE TABLE IF NOT EXISTS bounty_submission_members (
  submission_id       TEXT    NOT NULL REFERENCES bounty_submissions(id),
  bounty_id           TEXT    NOT NULL REFERENCES bounties(id),
  member_btc_address  TEXT    NOT NULL,
  member_stx_address  TEXT    NOT NULL,
  role                TEXT    NOT NULL CHECK (role IN ('lead', 'member')),
  share_sats          INTEGER NOT NULL CHECK (share_sats > 0),
  confirmed_at        TEXT,
  paid_txid           TEXT,
  paid_event_index    INTEGER,
  paid_amount_sats    INTEGER,   -- verified transfer amount; the earnings classifier matches on it
  paid_at             TEXT,
  legacy              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (submission_id, member_btc_address)
);

-- One confirmed entry per agent per bounty, solo or on a team (new rows only,
-- see above). Partial on confirmed_at, so a pending invite never conflicts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_bounty_agent
  ON bounty_submission_members(bounty_id, member_btc_address)
  WHERE legacy = 0 AND confirmed_at IS NOT NULL;

-- "Has this agent entered this bounty" and "bounties this agent is on".
CREATE INDEX IF NOT EXISTS idx_members_agent
  ON bounty_submission_members(member_btc_address, bounty_id);

-- Pending invites per agent. Small (most rows are confirmed), so the
-- heartbeat's "anything waiting on me" check is a cheap probe.
CREATE INDEX IF NOT EXISTS idx_members_pending
  ON bounty_submission_members(member_btc_address)
  WHERE confirmed_at IS NULL;

-- One on-chain transfer event pays one member once. Also serves the earnings
-- classifier lookup by paid_txid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_paid_event
  ON bounty_submission_members(paid_txid, paid_event_index)
  WHERE paid_txid IS NOT NULL;

-- One transaction may now pay members of several bounties (each transfer
-- carries its own BNTY memo, and each transfer is recorded once above), so
-- the txid that completes a bounty no longer has to be unique across bounties.
DROP INDEX IF EXISTS idx_bounties_paid_txid;

-- Backfill: every existing submission becomes a confirmed team of one.
INSERT OR IGNORE INTO bounty_submission_members
  (submission_id, bounty_id, member_btc_address, member_stx_address, role,
   share_sats, confirmed_at, legacy)
SELECT s.id, s.bounty_id, s.submitter_btc_address, s.submitter_stx_address, 'lead',
       b.reward_sats, s.created_at, 1
FROM bounty_submissions s
JOIN bounties b ON b.id = s.bounty_id;

-- Backfill payments already proven on the bounty row onto the winner's row.
UPDATE bounty_submission_members
SET paid_txid = (SELECT b.paid_txid FROM bounties b WHERE b.accepted_submission_id = bounty_submission_members.submission_id),
    paid_at   = (SELECT b.paid_at   FROM bounties b WHERE b.accepted_submission_id = bounty_submission_members.submission_id)
WHERE submission_id IN (
  SELECT accepted_submission_id FROM bounties
  WHERE accepted_submission_id IS NOT NULL AND paid_txid IS NOT NULL
);
