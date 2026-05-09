-- Migration 004: vouches table.
-- See docs/rfc-d1-schema.md `### `vouches`` section.
-- Replaces KV pattern vouch:{referrerBtc}:{refereeBtc} (VouchRecord).
-- The vouch:index:{btcAddress} index becomes SELECT WHERE referrer_btc = ?

CREATE TABLE vouches (
  referrer_btc      TEXT NOT NULL,
  referee_btc       TEXT NOT NULL,
  registered_at     TEXT NOT NULL,
  message_sent      INTEGER NOT NULL DEFAULT 0,
  paid_out          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (referrer_btc, referee_btc),
  FOREIGN KEY (referrer_btc) REFERENCES agents(btc_address),
  FOREIGN KEY (referee_btc)  REFERENCES agents(btc_address)
);

CREATE INDEX idx_vouches_referrer ON vouches(referrer_btc, registered_at DESC);
CREATE INDEX idx_vouches_referee ON vouches(referee_btc);
CREATE INDEX idx_vouches_paid_out ON vouches(paid_out, registered_at) WHERE paid_out = 0;
