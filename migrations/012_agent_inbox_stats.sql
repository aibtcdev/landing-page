-- Migration 012: agent_inbox_stats maintained-counter table.
--
-- Replaces live SELECT COUNT(*) queries on inbox_messages (O(N rows scanned))
-- with O(1) point-lookups on this single-row-per-agent table.
--
-- Columns:
--   btc_address    — primary key, matches agents.btc_address
--   received_count — total inbound messages (is_reply=0, to_btc_address=?)
--   unread_count   — inbound messages where read_at IS NULL
--   sent_count     — outbound replies sent (is_reply=1, from_btc_address=?)
--   last_message_at — ISO-8601 of most recent inbound received_at
--   last_sent_at   — ISO-8601 of most recent reply sent_at
--   updated_at     — ISO-8601 of last counter update (maintenance or backfill)
--
-- Write-path maintenance (see lib/inbox/stats.ts):
--   Inbound insert  → received_count++, unread_count++, last_message_at updated
--     only when INSERT ... ON CONFLICT DO NOTHING reports meta.changes === 1.
--   Mark-read PATCH → unread_count = MAX(0, unread_count - 1)
--     only when UPDATE ... WHERE read_at IS NULL reports meta.changes === 1.
--   Reply insert    → sent_count++, last_sent_at updated
--     only when reply INSERT ... ON CONFLICT DO NOTHING reports meta.changes === 1.
--
-- Repair: run rebuildAllStats() (lib/inbox/stats.ts) to recompute from
-- inbox_messages. Admin mutation paths (admin/backfill, admin/backfill-message-state)
-- do NOT update stats — run repair after admin mutations.
--
-- Quest: 2026-05-13-d1-count-bill-stop, P3
-- Closes cost-driver pattern documented in feedback_d1_count_antipattern.

CREATE TABLE IF NOT EXISTS agent_inbox_stats (
  btc_address     TEXT PRIMARY KEY,
  received_count  INTEGER NOT NULL DEFAULT 0,
  unread_count    INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  last_sent_at    TEXT,
  updated_at      TEXT NOT NULL
);
