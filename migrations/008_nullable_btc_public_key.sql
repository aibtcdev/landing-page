-- Migration 008: make btc_public_key NULLable for BIP-322 registrations.
--
-- Root cause: BIP-322 segwit signing (P2WPKH / bc1q) does not include the
-- public key in the signature output. Agents that registered via a segwit
-- wallet have btcPublicKey: "" (empty string) in KV — the pubkey was never
-- captured at registration time. This is a structural consequence of the
-- BIP-322 spec, not a data error.
--
-- As of 2026-05-10, 708 production KV records have stxAddress + stxPublicKey +
-- btcAddress + verifiedAt populated but btcPublicKey is empty. These are valid
-- registrations and must exist in the agents table so that all 951 agents are
-- visible to D1-backed routes (Phase 2.x read flips). NULL is the correct
-- stored value — do NOT copy stxPublicKey; the two keys derive from different
-- BIP-44 paths (m/44'/5060'/0' for Stacks vs m/84'/0'/0' for Bitcoin segwit).
--
-- D1 SQLite does NOT support `ALTER TABLE ... ALTER COLUMN` to drop NOT NULL.
-- The standard SQLite workaround is the table-rebuild dance. However, agents
-- is referenced by FK from claims, inbox_messages, vouches, swaps, and balances.
-- SQLite prevents DROP TABLE when there are child FK references. The approach:
--
--   Phase A — Rename agents_new (already prepared in emergency run) to agents_swap.
--   Phase B — Save child table data to temp tables.
--   Phase C — Drop child tables (FK removed), drop view, drop agents.
--   Phase D — Rename agents_swap (the new nullable schema) to agents.
--   Phase E — Recreate child tables with FKs pointing to the new agents.
--   Phase F — Restore data into child tables from temp tables.
--   Phase G — Drop temp tables.
--   Phase H — Recreate view and indexes.
--
-- NOTE (2026-05-10 emergency run): agents_new was already created and populated
-- with 243 rows (referred_by_btc restored to 30 rows) during the first failed
-- apply attempt. This migration picks up from that state.
-- If agents_new does NOT exist (clean run), this migration creates it from scratch.
--
-- This is a forward-only migration. If rollback is ever needed:
--   Agents with NULL btc_public_key are missing pubkey for cross-system
--   signature verification. However, live BIP-322 verification works because
--   the witness pubkey is present in the signature itself. The NULL column
--   only affects offline/batch lookups, not the verify endpoint.
--
-- References: #691 (D1 backfill sprint), #713 (this PR), SpaceX-5.

-- ── Phase A: Ensure agents_new exists with correct data ───────────────────
-- If agents_new was already created (from the emergency run), this is a no-op.
-- If running fresh, create it and populate it.

CREATE TABLE IF NOT EXISTS agents_new (
  btc_address           TEXT PRIMARY KEY,
  stx_address           TEXT NOT NULL UNIQUE,
  stx_public_key        TEXT NOT NULL,
  btc_public_key        TEXT,                 -- NULLable: absent for BIP-322/bc1q agents
  taproot_address       TEXT,
  display_name          TEXT,
  description           TEXT,
  bns_name              TEXT,
  owner                 TEXT,
  verified_at           TEXT NOT NULL,
  last_active_at        TEXT,
  erc8004_agent_id      INTEGER,
  nostr_public_key      TEXT,
  capabilities_json     TEXT,
  last_identity_check   TEXT,
  github_username       TEXT,
  referred_by_btc       TEXT,
  referral_code         TEXT NOT NULL UNIQUE,
  FOREIGN KEY (referred_by_btc) REFERENCES agents_new(btc_address)
);

-- Insert rows that are not already in agents_new (idempotent via ON CONFLICT DO NOTHING).
-- On fresh run: inserts all 243 rows with referred_by_btc = NULL.
-- On emergency-recovered run: no-ops (all rows already present).
INSERT OR IGNORE INTO agents_new
SELECT
  btc_address,
  stx_address,
  stx_public_key,
  btc_public_key,
  taproot_address,
  display_name,
  description,
  bns_name,
  owner,
  verified_at,
  last_active_at,
  erc8004_agent_id,
  nostr_public_key,
  capabilities_json,
  last_identity_check,
  github_username,
  NULL,            -- referred_by_btc: restored below after all rows exist
  referral_code
FROM agents;

-- Restore referred_by_btc values (idempotent: no-ops for already-restored rows).
UPDATE agents_new
SET referred_by_btc = (
  SELECT referred_by_btc FROM agents WHERE agents.btc_address = agents_new.btc_address
)
WHERE btc_address IN (
  SELECT btc_address FROM agents WHERE referred_by_btc IS NOT NULL
)
  AND referred_by_btc IS NULL;

-- ── Phase B: Save child table data to temp tables ─────────────────────────

CREATE TEMP TABLE tmp_claims AS SELECT * FROM claims;
CREATE TEMP TABLE tmp_inbox AS SELECT * FROM inbox_messages;
CREATE TEMP TABLE tmp_vouches AS SELECT * FROM vouches;
CREATE TEMP TABLE tmp_swaps AS SELECT * FROM swaps;
CREATE TEMP TABLE tmp_balances AS SELECT * FROM balances;

-- ── Phase C: Drop child tables, view, and old agents ─────────────────────

DROP VIEW IF EXISTS registered_wallets;
DROP TABLE IF EXISTS balances;
DROP TABLE IF EXISTS swaps;
DROP TABLE IF EXISTS vouches;
DROP TABLE IF EXISTS inbox_messages;
DROP TABLE IF EXISTS claims;
DROP TABLE IF EXISTS agents;

-- ── Phase D: Rename agents_new → agents ──────────────────────────────────

ALTER TABLE agents_new RENAME TO agents;

-- ── Phase E: Recreate child tables with FK pointing to new agents ─────────

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

CREATE TABLE inbox_messages (
  message_id            TEXT PRIMARY KEY,
  is_reply              INTEGER NOT NULL DEFAULT 0,
  reply_to_message_id   TEXT,
  from_stx_address      TEXT,
  from_btc_address      TEXT,
  to_btc_address        TEXT NOT NULL,
  to_stx_address        TEXT,
  content               TEXT NOT NULL,
  payment_txid          TEXT,
  payment_satoshis      INTEGER,
  payment_status        TEXT CHECK (payment_status IN (
                          'pending',
                          'confirmed',
                          'failed',
                          'replaced'
                        ) OR payment_status IS NULL),
  payment_terminal_reason TEXT,
  payment_error_code    TEXT,
  payment_replacement_txid TEXT,
  payment_id            TEXT,
  receipt_id            TEXT,
  recovered_via_txid    INTEGER NOT NULL DEFAULT 0,
  authenticated         INTEGER NOT NULL DEFAULT 0,
  bitcoin_signature     TEXT,
  sender_btc_address    TEXT,
  sent_at               TEXT NOT NULL,
  read_at               TEXT,
  replied_at            TEXT,
  CHECK (
    (is_reply = 0 AND from_stx_address IS NOT NULL AND from_btc_address IS NULL) OR
    (is_reply = 1 AND from_btc_address IS NOT NULL AND from_stx_address IS NULL)
  ),
  FOREIGN KEY (to_btc_address) REFERENCES agents(btc_address),
  FOREIGN KEY (reply_to_message_id) REFERENCES inbox_messages(message_id)
);

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

CREATE TABLE swaps (
  txid              TEXT PRIMARY KEY,
  sender            TEXT NOT NULL,
  contract_id       TEXT NOT NULL,
  function_name     TEXT NOT NULL,
  token_in          TEXT NOT NULL,
  token_out         TEXT NOT NULL,
  amount_in         INTEGER NOT NULL,
  amount_out        INTEGER NOT NULL,
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
  scored_value      INTEGER,
  scored_at         TEXT,
  source            TEXT NOT NULL CHECK (source IN ('agent', 'cron', 'chainhook')),
  raw_event_json    TEXT,
  FOREIGN KEY (sender) REFERENCES agents(stx_address)
);

CREATE TABLE balances (
  agent_address       TEXT NOT NULL,
  token_id            TEXT NOT NULL,
  captured_at         TEXT NOT NULL,
  raw_amount          INTEGER NOT NULL,
  decimals            INTEGER NOT NULL,
  usd_value           INTEGER,
  source              TEXT NOT NULL,
  PRIMARY KEY (agent_address, token_id, captured_at),
  FOREIGN KEY (agent_address) REFERENCES agents(stx_address)
);

-- ── Phase F: Restore data into child tables ───────────────────────────────

INSERT INTO claims SELECT * FROM tmp_claims;
INSERT INTO inbox_messages SELECT * FROM tmp_inbox;
INSERT INTO vouches SELECT * FROM tmp_vouches;
INSERT INTO swaps SELECT * FROM tmp_swaps;
INSERT INTO balances SELECT * FROM tmp_balances;

-- ── Phase G: Drop temp tables ─────────────────────────────────────────────

DROP TABLE tmp_claims;
DROP TABLE tmp_inbox;
DROP TABLE tmp_vouches;
DROP TABLE tmp_swaps;
DROP TABLE tmp_balances;

-- ── Phase H: Recreate view and indexes ───────────────────────────────────

CREATE VIEW registered_wallets AS
SELECT
  btc_address,
  stx_address,
  taproot_address,
  verified_at,
  last_active_at
FROM agents;

CREATE INDEX idx_agents_owner ON agents(lower(owner)) WHERE owner IS NOT NULL;
CREATE INDEX idx_agents_referred_by ON agents(referred_by_btc) WHERE referred_by_btc IS NOT NULL;
CREATE INDEX idx_agents_verified_at ON agents(verified_at);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at) WHERE last_active_at IS NOT NULL;
