-- Migration 022: earnings read-path index (issue #978, Phase 3)
--
-- Serves the public read API's aggregation:
--   - getEarningsLeaderboard: WHERE is_earning=1 AND block_time >= ?
--     GROUP BY recipient_agent_stx
--   - getAgentRollup: WHERE recipient_agent_stx = ? AND is_earning = 1
--
-- Partial on is_earning = 1 (the only rows the read path ever aggregates) and
-- leads recipient_agent_stx, so the leaderboard GROUP BY needs no transient
-- B-tree and per-agent rollups seek straight to the agent's earning rows.
-- Migration 020's non-partial (recipient_agent_stx, block_time) index stays for
-- the indexer's own reads.
CREATE INDEX IF NOT EXISTS idx_agent_earnings_leaderboard
  ON agent_earnings (recipient_agent_stx, block_time) WHERE is_earning = 1;
