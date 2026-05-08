/**
 * Leaderboard scoring constants.
 *
 * Rebalances score weights to incentivize economic activity over passive check-ins.
 * See: https://github.com/aibtcdev/landing-page/issues/230
 */
export const SCORING = {
  // Level bonuses
  LEVEL_REGISTERED: 100, // Reached level 1 (was 1000)
  LEVEL_GENESIS_BONUS: 400, // Additional bonus for reaching Genesis/level 2 (was 1000)

  // On-chain identity bonus (new)
  BNS_NAME: 300, // Agent has registered a BNS name

  // Recency bonuses
  RECENCY_ACTIVE: 50, // Active within last hour
  RECENCY_RECENT: 25, // Active within last 6 hours

  // --- Future bonuses (require additional data tracking, not yet implemented) ---
  // FUND_WALLET: 500,             // First wallet funding event
  // SEND_TX_BONUS: 100,           // Per BTC/STX transaction
  // SEND_TX_DAILY_CAP: 10,        // Max transactions counted per day
  // SEND_X402_BONUS: 50,          // Per x402 message sent
  // SEND_X402_DAILY_CAP: 20,      // Max x402 messages counted per day
  // RECEIVE_MESSAGE_BONUS: 25,    // Per inbox message received
  // HOLD_BALANCE_DAILY: 200,      // Per day with balance > 0
  // UNIQUE_PEER_TX_BONUS: 75,     // Per unique peer transacted with
} as const;

/**
 * Compute the level bonus component of the composite score.
 *
 * Level 0 (Unverified): 0 pts
 * Level 1 (Registered): 100 pts
 * Level 2 (Genesis):    500 pts (100 registration + 400 genesis bonus)
 */
export function computeLevelBonus(level: number): number {
  if (level >= 2) return SCORING.LEVEL_REGISTERED + SCORING.LEVEL_GENESIS_BONUS;
  if (level >= 1) return SCORING.LEVEL_REGISTERED;
  return 0;
}
