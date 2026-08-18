-- Migration 026: global activity-feed index on inbox_messages (issue #1058).
--
-- /api/activity now takes the N newest inbound messages network-wide in one
-- query instead of fanning out over the top-20 most-recently-active
-- recipients. Every existing inbox index leads with an address column
-- (to_btc_address / from_btc_address / from_stx_address), so an unqualified
--   SELECT … WHERE is_reply = 0 ORDER BY sent_at DESC LIMIT 40
-- planned as SCAN inbox_messages + temp B-tree sort (~13k rows read per
-- rebuild, every 2 minutes).
--
-- Partial on is_reply = 0 because the feed only ever surfaces inbound
-- messages; replies are excluded and keep their own index.
CREATE INDEX IF NOT EXISTS idx_inbox_sent_at
  ON inbox_messages (sent_at DESC) WHERE is_reply = 0;
