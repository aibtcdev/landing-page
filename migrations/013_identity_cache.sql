-- Migration 013: identity_cache table.
--
-- Replaces KV writes for `cache:bns:{stxAddress}` and
-- `cache:identity:{stxAddress}` key families in lib/identity/kv-cache.ts.
--
-- Three-state cache model preserved:
--   state = 'positive'           — Hiro returned a name/NFT (24h TTL for BNS, 24h for identity)
--   state = 'confirmed-negative' — Hiro authoritatively said "no name" / "no NFT" (7d TTL)
--   state = 'lookup-failed'      — transient Hiro error (60s TTL); do not poison long-TTL entry
--
-- TTL enforcement: expires_at (ISO-8601 UTC) checked at read time in Worker.
-- Expired rows are evicted lazily by INSERT OR REPLACE on the next write.
-- D1 has no native TTL; this is the established pattern for time-bounded D1 entries.
--
-- Access pattern: ALL hot-path reads are single-row primary-key lookups.
--   SELECT state, value, expires_at FROM identity_cache WHERE cache_type = ? AND address = ?
-- No COUNT(*), no GROUP BY, no aggregates on any hot path.
--
-- Quest: 2026-05-14-kv-write-bill-stop, P2
-- Closes KV write driver tracked in aibtcdev/landing-page#762-B.
-- OPERATOR NOTE: Apply with `wrangler d1 migrations apply landing-page --env production --remote`
-- This is out-of-band from the Worker deploy.

CREATE TABLE IF NOT EXISTS identity_cache (
  cache_type  TEXT NOT NULL,  -- 'bns' | 'identity'
  address     TEXT NOT NULL,  -- stxAddress (normalized to lowercase by caller)
  state       TEXT NOT NULL,  -- 'positive' | 'confirmed-negative' | 'lookup-failed'
  value       TEXT,           -- name string (bns positive), JSON AgentIdentity (identity positive), NULL for all negative/failed states
  expires_at  TEXT NOT NULL,  -- ISO-8601 UTC string, e.g. '2026-05-15T23:00:00.000Z'
  PRIMARY KEY (cache_type, address)
);
