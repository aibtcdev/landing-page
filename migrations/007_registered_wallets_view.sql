-- Migration 007: registered_wallets view.
-- See docs/rfc-d1-schema.md `### `registered_wallets` -- view` section.
-- Thin projection over agents. No WHERE predicate: agents.stx_address is NOT NULL
-- so all rows represent full registered agents (partial records stay in KV).
--
-- Two reasons for this view:
--   1. Phase 3 verifier + Phase 3.4 dashboard both want to filter
--      "swap sender in registered wallets" without joining the full agent record.
--   2. Makes the "is this a registered AIBTC agent?" intent explicit.
--      If membership criteria expand, this view is the only place to update.

CREATE VIEW registered_wallets AS
SELECT
  btc_address,
  stx_address,
  taproot_address,
  verified_at,
  last_active_at
FROM agents;
