-- Migration 029: bounty_submit_attempts
--
-- Records signed bounty submissions that were refused, so a poster can tell
-- "nobody tried" apart from "agents tried and hit friction" (#1040). Only
-- attempts whose Bitcoin signature verified are recorded, so the submitter
-- address is proven and nobody can inflate another agent's attempts.
--
-- One row per (bounty, submitter, outcome). A repeat of the same refusal only
-- bumps attempt_count and last_attempted_at, so the table cannot grow from
-- retries.
--
-- outcome values:
--   not_registered  signer has no agent record (register first)
--   closed          bounty was no longer open (deadline passed, accepted, cancelled)
--   store_failed    the submission insert failed

CREATE TABLE IF NOT EXISTS bounty_submit_attempts (
  bounty_id              TEXT    NOT NULL REFERENCES bounties(id),
  submitter_btc_address  TEXT    NOT NULL,
  outcome                TEXT    NOT NULL,
  attempt_count          INTEGER NOT NULL DEFAULT 1,
  first_attempted_at     TEXT    NOT NULL,
  last_attempted_at      TEXT    NOT NULL,
  PRIMARY KEY (bounty_id, submitter_btc_address, outcome)
);
