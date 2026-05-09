-- Migration 001: agents table.
-- See docs/rfc-d1-schema.md `### `agents`` section.
-- Replaces KV pattern stx:{stxAddress} and btc:{btcAddress} (dual-indexed AgentRecord).
-- Referral codes (referral-code:{btcAddress} + referral-lookup:{CODE}) folded in as columns.

CREATE TABLE agents (
  btc_address           TEXT PRIMARY KEY,
  stx_address           TEXT NOT NULL UNIQUE,
  stx_public_key        TEXT NOT NULL,
  btc_public_key        TEXT NOT NULL,
  taproot_address       TEXT,
  display_name          TEXT,
  description           TEXT,
  bns_name              TEXT,
  -- owner is the X (Twitter) handle
  owner                 TEXT,
  -- verified_at is ISO-8601
  verified_at           TEXT NOT NULL,
  last_active_at        TEXT,
  erc8004_agent_id      INTEGER,
  nostr_public_key      TEXT,
  -- capabilities_json is a JSON array, optional
  capabilities_json     TEXT,
  last_identity_check   TEXT,
  github_username       TEXT,
  -- referred_by_btc is the BTC address of the referrer
  referred_by_btc       TEXT,
  -- referral_code is the 6-char code (was referral-code:{btcAddress})
  referral_code         TEXT NOT NULL UNIQUE,
  -- D1 enforces foreign keys by default (equivalent to PRAGMA foreign_keys=ON).
  -- Cycle is intentional: agents.referred_by_btc -> agents.btc_address self-FK.
  FOREIGN KEY (referred_by_btc) REFERENCES agents(btc_address)
);

-- stx_address already has an implicit unique index from the UNIQUE constraint;
-- no separate idx_agents_stx needed.
CREATE INDEX idx_agents_owner ON agents(lower(owner)) WHERE owner IS NOT NULL;
CREATE INDEX idx_agents_referred_by ON agents(referred_by_btc) WHERE referred_by_btc IS NOT NULL;
CREATE INDEX idx_agents_verified_at ON agents(verified_at);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at) WHERE last_active_at IS NOT NULL;
