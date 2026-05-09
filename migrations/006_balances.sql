-- Migration 006: balances table.
-- See docs/rfc-d1-schema.md `### `balances`` section.
-- Per-agent token balance snapshots (Phase 3).
-- Populated by Phase 3.3 5-minute cron. Replaces #651 on-rebuild fan-out.
--
-- agent_address is the STX address.
-- token_id: "stx", "sbtc", "btc-l1", or contract_id of SIP-10.
-- captured_at is ISO-8601.
-- raw_amount is in on-chain units; decimals stored per-row for display.
-- usd_value is microUSD (x1_000_000), NULL if price-feed unavailable.
-- source: "hiro" | "mempool.space" | "stacks-rpc"
--
-- Phase 3.3 cron ships a 90-day TTL sweep:
--   DELETE FROM balances WHERE captured_at < datetime('now', '-90 days')
-- See RFC Decision 6 (SpaceX-5 efficiency) for rationale.

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

-- Per-agent balance history (covers BOTH per-agent drill-in AND the dashboard
-- "latest snapshot per agent per token" query -- leftmost prefix matches both).
CREATE INDEX idx_balances_agent_token_time ON balances(agent_address, token_id, captured_at DESC);
