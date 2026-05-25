-- Migration 018: index for "sent originals" lookups on inbox_messages.
--
-- The agent inbox page's "Sent" tab lists messages an agent AUTHORED to other
-- agents (is_reply=0), keyed by the sender's STX identity (from_stx_address —
-- the x402 payer recorded at delivery). The existing indexes only cover
-- received (idx_inbox_to_btc_sent_at, by to_btc_address) and replies
-- (idx_inbox_outbox_from_btc_sent_at, by from_btc_address); neither serves a
-- from_stx_address lookup, so the paginated newest-first query would otherwise
-- scan every is_reply=0 row to sort.
--
-- This partial index makes GET /api/inbox/[address]?view=sent an index range
-- scan bounded to the LIMIT/OFFSET window — D1 bills only the rows in the page,
-- keeping cost flat as message volume grows.
--
-- Query served:
--   SELECT … FROM inbox_messages
--   WHERE is_reply = 0 AND from_stx_address = ?
--   ORDER BY sent_at DESC
--   LIMIT ? OFFSET ?

CREATE INDEX IF NOT EXISTS idx_inbox_sent_from_stx
  ON inbox_messages(from_stx_address, sent_at DESC)
  WHERE is_reply = 0;
