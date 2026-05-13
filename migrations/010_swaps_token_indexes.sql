-- Migration 010: composite indexes on swaps for dynamic-token-discovery queries.
--
-- Backs the `getActiveTokenIds(db)` SQL in `lib/external/tenero/tokens.ts`
-- (shipped in PR #800), which runs every 5 min on the SchedulerDO tick:
--
--   SELECT id, SUM(cnt) AS cnt FROM (
--     SELECT token_in AS id, COUNT(*) AS cnt FROM swaps
--     WHERE source IN ('agent','cron') AND tx_status = 'success'
--       AND token_in IS NOT NULL AND token_in != 'unknown'
--     GROUP BY token_in
--     UNION ALL
--     SELECT token_out AS id, COUNT(*) AS cnt FROM swaps
--     WHERE source IN ('agent','cron') AND tx_status = 'success'
--       AND token_out IS NOT NULL AND token_out != 'unknown'
--     GROUP BY token_out
--   )
--   GROUP BY id ORDER BY SUM(cnt) DESC LIMIT 50;
--
-- Today the swaps table has ~1 row so the full-table scan is invisible. arc
-- flagged in PR #800 review that once `swaps` reaches ~10k rows this fires
-- on every tick and a composite (source, tx_status, token_in/_out) index will
-- let SQLite range-scan the right slice and group it without touching rows
-- outside the active scope.
--
-- Both columns are indexed because the UNION ALL hits one then the other;
-- a single-column index on either alone wouldn't cover both legs.
--
-- The pre-existing indexes from migration 005 (sender_burn_time, scored_at,
-- contract_burn_time) cover the other read paths and are untouched.

CREATE INDEX IF NOT EXISTS idx_swaps_token_in_active
  ON swaps (source, tx_status, token_in);

CREATE INDEX IF NOT EXISTS idx_swaps_token_out_active
  ON swaps (source, tx_status, token_out);
