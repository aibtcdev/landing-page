-- Migration 003: inbox_messages table.
-- See docs/rfc-d1-schema.md `### `inbox_messages`` section.
-- Replaces KV patterns inbox:message:{messageId} (InboxMessage) and
-- inbox:reply:{messageId} (OutboxReply). The two are folded into one table via is_reply.
--
-- Sender address columns: exactly one is populated per row.
--   Inbound (is_reply=0) rows have from_stx_address (payer's STX from x402 settlement).
--   Reply (is_reply=1) rows have from_btc_address (recipient's BTC, BIP-322 signed-in).
--
-- payment_status mirrors x402-sponsor-relay PaymentStatus terminal outcomes only.
-- NULL when the row is a reply (no payment) or a fresh inbound before any settlement step.
--
-- bitcoin_signature is a single column for both inbound and reply paths (BIP-322 only:
-- bc1q P2WPKH, bc1p P2TR). Generic name accommodates future BIP-340/Schnorr without rename.

CREATE TABLE inbox_messages (
  message_id            TEXT PRIMARY KEY,
  -- is_reply: 0 = inbound message, 1 = outbox reply
  is_reply              INTEGER NOT NULL DEFAULT 0,
  -- reply_to_message_id is the message being replied to (NULL for inbound)
  reply_to_message_id   TEXT,
  -- from_stx_address is the payer's STX (inbound only)
  from_stx_address      TEXT,
  -- from_btc_address is the replier's BTC (reply only)
  from_btc_address      TEXT,
  to_btc_address        TEXT NOT NULL,
  -- to_stx_address is NULL for replies (BTC routing only)
  to_stx_address        TEXT,
  content               TEXT NOT NULL,
  payment_txid          TEXT,
  -- payment_satoshis is NULL for replies (free)
  payment_satoshis      INTEGER,
  payment_status        TEXT CHECK (payment_status IN (
                          'pending',
                          'confirmed',
                          'failed',
                          'replaced'
                        ) OR payment_status IS NULL),
  -- payment_terminal_reason mirrors canonical TerminalReason from @aibtc/tx-schemas/core
  payment_terminal_reason TEXT,
  -- payment_error_code is machine-readable (e.g., INSUFFICIENT_FUNDS)
  payment_error_code    TEXT,
  -- payment_replacement_txid is the replacement on-chain txid for RBF tracking
  payment_replacement_txid TEXT,
  -- payment_id is the relay payment identity for staged/confirmed
  payment_id            TEXT,
  -- receipt_id is the relay verify endpoint
  receipt_id            TEXT,
  -- recovered_via_txid: 1 if delivered via txid recovery path
  recovered_via_txid    INTEGER NOT NULL DEFAULT 0,
  -- authenticated: 1 if Bitcoin signature verified at submit time
  authenticated         INTEGER NOT NULL DEFAULT 0,
  -- bitcoin_signature for both inbound and reply paths
  bitcoin_signature     TEXT,
  -- sender_btc_address recovered from bitcoin_signature on inbound
  sender_btc_address    TEXT,
  -- sent_at is ISO-8601
  sent_at               TEXT NOT NULL,
  -- read_at is an inbound-message-only field
  read_at               TEXT,
  -- replied_at is an inbound-message-only field
  replied_at            TEXT,
  CHECK (
    (is_reply = 0 AND from_stx_address IS NOT NULL AND from_btc_address IS NULL) OR
    (is_reply = 1 AND from_btc_address IS NOT NULL AND from_stx_address IS NULL)
  ),
  FOREIGN KEY (to_btc_address) REFERENCES agents(btc_address),
  FOREIGN KEY (reply_to_message_id) REFERENCES inbox_messages(message_id)
);

-- Per-recipient inbox listing (the dominant read pattern)
CREATE INDEX idx_inbox_to_btc_sent_at ON inbox_messages(to_btc_address, sent_at DESC) WHERE is_reply = 0;

-- Per-recipient outbox listing (replies they've sent)
CREATE INDEX idx_inbox_outbox_from_btc_sent_at ON inbox_messages(from_btc_address, sent_at DESC) WHERE is_reply = 1;

-- Unread count per recipient (closes aibtc-mcp-server#497 via live SELECT COUNT(*))
CREATE INDEX idx_inbox_unread ON inbox_messages(to_btc_address) WHERE is_reply = 0 AND read_at IS NULL;

-- Reply chain lookups
CREATE INDEX idx_inbox_reply_to ON inbox_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- Txid double-redemption prevention (ALL recovery paths share this lookup).
-- PERMANENT: replaces the 90-day KV TTL on inbox:redeemed-txid:{txid}.
-- A txid is a one-time on-chain event; permanent uniqueness is the correct model.
CREATE UNIQUE INDEX idx_inbox_payment_txid ON inbox_messages(payment_txid) WHERE payment_txid IS NOT NULL;
