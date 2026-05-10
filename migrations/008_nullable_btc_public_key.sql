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
-- The standard SQLite workaround is the table-rebuild dance:
--   1. Create agents_new with the desired schema (btc_public_key NULL).
--   2. Copy all rows from agents.
--   3. Drop the old table.
--   4. Rename the new table.
--   5. Recreate all indexes.
--
-- This is a forward-only migration. If rollback is ever needed:
--   Agents with NULL btc_public_key are missing pubkey for cross-system
--   signature verification. However, live BIP-322 verification works because
--   the witness pubkey is present in the signature itself. The NULL column
--   only affects offline/batch lookups, not the verify endpoint.
--
-- References: #691 (D1 backfill sprint), SpaceX-5 (dual-sig + x402 flows).

-- Step 1: Create the new table with btc_public_key NULL.
CREATE TABLE agents_new (
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

-- Step 2a: Copy all rows with referred_by_btc = NULL first to satisfy the
-- self-referential FK constraint during the bulk INSERT. The FK on agents_new
-- points to agents_new.btc_address, so rows with referrals fail if the
-- referrer row hasn't been inserted yet. We clear it here and restore below.
INSERT INTO agents_new
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
  NULL,            -- referred_by_btc: restored in step 2b after all rows exist
  referral_code
FROM agents;

-- Step 2b: Restore referred_by_btc values now that all rows exist in agents_new.
-- Standard SQLite correlated-update syntax (no FROM clause).
UPDATE agents_new
SET referred_by_btc = (
  SELECT referred_by_btc FROM agents WHERE agents.btc_address = agents_new.btc_address
)
WHERE btc_address IN (
  SELECT btc_address FROM agents WHERE referred_by_btc IS NOT NULL
);

-- Step 3: Drop the old table (and its indexes — they are table-scoped).
DROP TABLE agents;

-- Step 4: Rename the new table to agents.
ALTER TABLE agents_new RENAME TO agents;

-- Step 5: Recreate all indexes from migration 001.
CREATE INDEX idx_agents_owner ON agents(lower(owner)) WHERE owner IS NOT NULL;
CREATE INDEX idx_agents_referred_by ON agents(referred_by_btc) WHERE referred_by_btc IS NOT NULL;
CREATE INDEX idx_agents_verified_at ON agents(verified_at);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at) WHERE last_active_at IS NOT NULL;
