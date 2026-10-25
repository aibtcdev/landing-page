-- Migration 030: optional opens_at on bounties (#1113)
--
-- Allows a poster to announce terms before entries are accepted.
-- Nullable column: NULL or <= now means open immediately; > now means scheduled.

ALTER TABLE bounties ADD COLUMN opens_at TEXT;
