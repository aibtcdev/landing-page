-- Migration 019: one-time repair for agent_inbox_stats drift.
--
-- Issue #906 exposed a phantom unread where agent_inbox_stats.unread_count
-- exceeded the source-of-truth rows in inbox_messages. This migration rebuilds
-- the maintained counter table from inbox_messages once, preserving the hot
-- GET path's O(1) stats lookup without adding runtime COUNT(*) scans.

DELETE FROM agent_inbox_stats;

WITH
  inbound AS (
    SELECT
      to_btc_address AS btc_address,
      COUNT(*) AS received_count,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
      MAX(sent_at) AS last_message_at
    FROM inbox_messages
    WHERE is_reply = 0
    GROUP BY to_btc_address
  ),
  sent AS (
    SELECT
      from_btc_address AS btc_address,
      COUNT(*) AS sent_count,
      MAX(sent_at) AS last_sent_at
    FROM inbox_messages
    WHERE is_reply = 1
      AND from_btc_address IS NOT NULL
    GROUP BY from_btc_address
  ),
  addresses AS (
    SELECT btc_address FROM inbound
    UNION
    SELECT btc_address FROM sent
  )
INSERT INTO agent_inbox_stats (
  btc_address,
  received_count,
  unread_count,
  sent_count,
  last_message_at,
  last_sent_at,
  updated_at
)
SELECT
  addresses.btc_address,
  COALESCE(inbound.received_count, 0),
  COALESCE(inbound.unread_count, 0),
  COALESCE(sent.sent_count, 0),
  inbound.last_message_at,
  sent.last_sent_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM addresses
LEFT JOIN inbound ON inbound.btc_address = addresses.btc_address
LEFT JOIN sent ON sent.btc_address = addresses.btc_address
WHERE addresses.btc_address IS NOT NULL
  AND addresses.btc_address != '';
