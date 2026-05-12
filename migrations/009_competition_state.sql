-- Migration 009: competition_state table.
-- Tiny K/V scratchpad for the competition cron's persistent state.
-- Replaces KV `comp:cron:cursor` per @whoabuddy's #738 review note that
-- "we need cursor state" (https://github.com/aibtcdev/landing-page/pull/738#issuecomment-4426307229):
-- queryable, durable, and lives in the same store as everything else the
-- comp surface reads/writes.
--
-- Schema is intentionally generic — future cron state (last_run_at,
-- consecutive_failures, etc.) reuses the same table rather than spawning
-- one tiny migration per signal.

CREATE TABLE competition_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
