/**
 * Single round-trip: aggregate `swaps` per (sender, token_in, token_out)
 * and INNER JOIN the display fields from `agents`. The wider GROUP BY lets
 * the client compute both:
 *   - Volume USD = sum(amount_in * price[token_in])          ("notional spent")
 *   - P&L USD    = sum(amount_out * price[token_out]
 *                   - amount_in * price[token_in])           ("net at end prices")
 *
 * Filter rationale:
 *   - `tx_status = 'success'` counts only swaps that moved tokens.
 *   - `source IN ('agent', 'cron', 'chainhook')` restates the
 *     `migrations/005_swaps.sql` CHECK constraint as query intent.
 *   - `INNER JOIN agents` + verified/rewarded claim + non-null
 *     `erc8004_agent_id` mirrors `senderEligibilityTier` in
 *     `lib/competition/verify.ts`: Verified Agent + Genesis claim +
 *     ERC-8004 identity.
 */
export const LEADERBOARD_AGGREGATE_SQL = `
  SELECT s.sender, s.token_in, s.token_out,
         COUNT(*)             AS cnt,
         SUM(s.amount_in)     AS sum_in,
         SUM(s.amount_out)    AS sum_out,
         MAX(s.burn_block_time) AS latest_at,
         a.btc_address, a.display_name, a.bns_name, a.erc8004_agent_id
  FROM swaps s
  INNER JOIN agents a ON a.stx_address = s.sender
  WHERE s.tx_status = 'success'
    AND s.source IN ('agent', 'cron', 'chainhook')
    AND a.erc8004_agent_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM claims c
      WHERE c.btc_address = a.btc_address
        AND c.status IN ('verified', 'rewarded')
    )
  GROUP BY s.sender, s.token_in, s.token_out
`;
