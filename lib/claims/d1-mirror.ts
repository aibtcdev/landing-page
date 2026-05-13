import type { ClaimRecord } from "@/lib/types";

export async function mirrorClaimToD1(
  db: D1Database | undefined,
  claim: ClaimRecord
): Promise<void> {
  if (!db) return;

  await db
    .prepare(
      `INSERT INTO claims (
         btc_address, display_name, tweet_url, tweet_author,
         claimed_at, reward_satoshis, reward_txid, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(btc_address) DO UPDATE SET
         display_name = excluded.display_name,
         tweet_url = excluded.tweet_url,
         tweet_author = excluded.tweet_author,
         claimed_at = excluded.claimed_at,
         reward_satoshis = excluded.reward_satoshis,
         reward_txid = excluded.reward_txid,
         status = excluded.status`
    )
    .bind(
      claim.btcAddress,
      claim.displayName,
      claim.tweetUrl,
      claim.tweetAuthor ?? null,
      claim.claimedAt,
      claim.rewardSatoshis,
      claim.rewardTxid ?? null,
      claim.status
    )
    .run();
}
