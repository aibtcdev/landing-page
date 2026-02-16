/**
 * Achievement Verification Logic
 *
 * Reusable functions for verifying on-chain achievements.
 * Used by manual verification endpoint and proactive checks during heartbeat/profile loading.
 */

import {
  getCachedTransaction,
  setCachedTransaction,
} from "@/lib/identity/kv-cache";

/** Rate limit window for achievement verification (5 minutes) */
export const ACHIEVEMENT_VERIFY_RATE_LIMIT_MS = 5 * 60 * 1000;

/**
 * Check if an achievement verification is rate-limited.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 * @returns Object with allowed flag and optional wait time in seconds
 */
export async function checkRateLimit(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string
): Promise<{ allowed: boolean; waitSecs?: number }> {
  const key = `ratelimit:achievement-verify:${btcAddress}:${achievementId}`;
  const lastCheck = await kv.get(key);

  if (!lastCheck) {
    return { allowed: true };
  }

  const elapsed = Date.now() - parseInt(lastCheck, 10);
  if (elapsed >= ACHIEVEMENT_VERIFY_RATE_LIMIT_MS) {
    return { allowed: true };
  }

  const waitSecs = Math.ceil((ACHIEVEMENT_VERIFY_RATE_LIMIT_MS - elapsed) / 1000);
  return { allowed: false, waitSecs };
}

/**
 * Set rate limit for an achievement verification.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param achievementId - Achievement ID
 */
export async function setRateLimit(
  kv: KVNamespace,
  btcAddress: string,
  achievementId: string
): Promise<void> {
  const key = `ratelimit:achievement-verify:${btcAddress}:${achievementId}`;
  await kv.put(key, String(Date.now()), { expirationTtl: 300 });
}

/**
 * Verify if an agent has sent outgoing Bitcoin transactions (Sender achievement).
 *
 * Checks mempool.space for transactions where the agent's address appears as an input.
 * Uses KV cache with 5-minute TTL to avoid excessive API calls.
 *
 * @param btcAddress - Bitcoin address to check
 * @param kv - Cloudflare KV namespace
 * @returns true if the agent has sent BTC, false otherwise
 */
export async function verifySenderAchievement(
  btcAddress: string,
  kv: KVNamespace
): Promise<boolean> {
  try {
    const cacheKey = `mempool:${btcAddress}`;
    let txs = await getCachedTransaction(cacheKey, kv);

    if (!txs) {
      const mempoolUrl = `https://mempool.space/api/address/${btcAddress}/txs`;
      const mempoolResp = await fetch(mempoolUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!mempoolResp.ok) {
        console.error(
          `Failed to fetch mempool data for ${btcAddress}: ${mempoolResp.status}`
        );
        return false;
      }

      txs = (await mempoolResp.json()) as Array<{
        vin: Array<{ prevout: { scriptpubkey_address: string } }>;
      }>;

      // Cache the result
      await setCachedTransaction(cacheKey, txs, kv);
    }

    // Check if any transaction has this address as an input
    const hasOutgoingTx = txs.some((tx: any) =>
      tx.vin.some(
        (input: any) => input.prevout.scriptpubkey_address === btcAddress
      )
    );

    return hasOutgoingTx;
  } catch (error) {
    console.error(`Failed to verify sender achievement for ${btcAddress}:`, error);
    return false;
  }
}
