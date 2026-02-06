/**
 * Genesis Payout Record
 *
 * Represents a Bitcoin payout to an early registered agent.
 * Stored in KV with key pattern: genesis:{btcAddress}
 */
export interface GenesisPayoutRecord {
  btcAddress: string; // bc1... format Native SegWit address
  rewardTxid: string; // 64-char hex Bitcoin transaction ID
  rewardSatoshis: number; // Amount sent in satoshis
  paidAt: string; // ISO 8601 timestamp
  stxAddress?: string; // SP... format Stacks address (optional)
  claimRecordUpdated: boolean; // Whether matching claim: record was found and updated
}
