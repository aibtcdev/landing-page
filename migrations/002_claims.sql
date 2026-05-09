-- Migration 002: claims table.
-- See docs/rfc-d1-schema.md `### `claims`` section.
-- Replaces KV pattern claim:{btcAddress} (ClaimRecord).

CREATE TABLE claims (
  btc_address       TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  tweet_url         TEXT NOT NULL,
  tweet_author      TEXT,
  claimed_at        TEXT NOT NULL,
  reward_satoshis   INTEGER NOT NULL DEFAULT 0,
  reward_txid       TEXT,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rewarded', 'failed')),
  FOREIGN KEY (btc_address) REFERENCES agents(btc_address)
);

CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_claimed_at ON claims(claimed_at);
