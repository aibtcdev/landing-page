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
import { buildHiroHeaders } from "@/lib/identity/stacks-api";

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
    const cacheKey = `mempool-addr:${btcAddress}`;
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

/**
 * Count outgoing Bitcoin transactions for an agent.
 *
 * Uses the same mempool.space cache as verifySenderAchievement.
 * Returns 0 on error rather than throwing.
 *
 * @param btcAddress - Bitcoin address to check
 * @param kv - Cloudflare KV namespace
 * @returns Count of transactions where this address appears as an input
 */
export async function getBtcTxCount(
  btcAddress: string,
  kv: KVNamespace
): Promise<number> {
  try {
    const cacheKey = `mempool-addr:${btcAddress}`;
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
        return 0;
      }

      txs = (await mempoolResp.json()) as Array<{
        vin: Array<{ prevout: { scriptpubkey_address: string } }>;
      }>;

      await setCachedTransaction(cacheKey, txs, kv);
    }

    return (txs as Array<{ vin: Array<{ prevout: { scriptpubkey_address: string } }> }>).filter(
      (tx) => tx.vin.some((input) => input.prevout.scriptpubkey_address === btcAddress)
    ).length;
  } catch (error) {
    console.error(`Failed to count BTC txs for ${btcAddress}:`, error);
    return 0;
  }
}

/**
 * Verify if an agent's wallet has ever received any incoming BTC transaction (Fund Wallet signal).
 *
 * Reuses the same mempool.space cache as verifySenderAchievement.
 * Returns false on error rather than throwing.
 *
 * @param btcAddress - Bitcoin address to check
 * @param kv - Cloudflare KV namespace
 * @returns true if the address has received any BTC, false otherwise
 */
export async function verifyWalletFunded(
  btcAddress: string,
  kv: KVNamespace
): Promise<boolean> {
  try {
    const cacheKey = `mempool-addr:${btcAddress}`;
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
        vout: Array<{ scriptpubkey_address: string }>;
      }>;

      await setCachedTransaction(cacheKey, txs, kv);
    }

    // Check if any transaction has this address as an output (incoming funds)
    return (txs as Array<{ vout: Array<{ scriptpubkey_address: string }> }>).some(
      (tx) => tx.vout.some((output) => output.scriptpubkey_address === btcAddress)
    );
  } catch (error) {
    console.error(`Failed to verify wallet funded for ${btcAddress}:`, error);
    return false;
  }
}

/**
 * Count outgoing Stacks transactions for an agent.
 *
 * Queries the Stacks Extended API for transactions sent by the agent's address.
 * Uses KV cache with 5-minute TTL.
 *
 * @param stxAddress - Stacks address to check
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns Count of outgoing Stacks transactions
 */
export async function getStxTxCount(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<number> {
  try {
    const cacheKey = `stx-txs:${stxAddress}`;
    let cached = await getCachedTransaction(cacheKey, kv);

    if (!cached) {
      const url = `https://api.hiro.so/extended/v1/address/${stxAddress}/transactions?limit=50`;
      const resp = await fetch(url, {
        headers: buildHiroHeaders(hiroApiKey),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        console.error(`Failed to fetch STX txs for ${stxAddress}: ${resp.status}`);
        return 0;
      }

      cached = await resp.json();
      await setCachedTransaction(cacheKey, cached, kv);
    }

    const results = (
      cached as { results?: Array<{ sender_address: string }> }
    ).results ?? [];
    return results.filter((tx) => tx.sender_address === stxAddress).length;
  } catch (error) {
    console.error(`Failed to count STX txs for ${stxAddress}:`, error);
    return 0;
  }
}

/**
 * Verify if an agent holds a positive STX or sBTC balance (Holding signal).
 *
 * Reuses the same Stacks balance cache as verifysBtcHolderAchievement.
 * Returns false on error rather than throwing.
 *
 * @param stxAddress - Stacks address to check
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns true if the agent holds any STX or sBTC balance
 */
export async function verifyPositiveBalance(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<boolean> {
  try {
    const cacheKey = `sbtc-balance:${stxAddress}`;
    let balanceData = await getCachedTransaction(cacheKey, kv);

    if (!balanceData) {
      const balanceUrl = `https://api.hiro.so/extended/v1/address/${stxAddress}/balances`;
      const balanceResp = await fetch(balanceUrl, {
        headers: buildHiroHeaders(hiroApiKey),
        signal: AbortSignal.timeout(10000),
      });

      if (!balanceResp.ok) {
        console.error(
          `Failed to fetch balances for ${stxAddress}: ${balanceResp.status}`
        );
        return false;
      }

      balanceData = await balanceResp.json();
      await setCachedTransaction(cacheKey, balanceData, kv);
    }

    const stxBalance = parseInt(
      (balanceData as { stx?: { balance: string } }).stx?.balance ?? "0",
      10
    );
    if (stxBalance > 0) return true;

    const fungibleTokens = (
      balanceData as { fungible_tokens?: Record<string, { balance: string }> }
    ).fungible_tokens ?? {};
    const sBtcKey = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
    const sBtcBalance = parseInt(fungibleTokens[sBtcKey]?.balance ?? "0", 10);
    return sBtcBalance > 0;
  } catch (error) {
    console.error(`Failed to verify positive balance for ${stxAddress}:`, error);
    return false;
  }
}

/**
 * Verify if an agent has STX stacked via Proof of Transfer (Stacker achievement).
 *
 * Checks the Stacks Extended API stacking endpoint for locked STX > 0.
 * Uses KV cache with 5-minute TTL to avoid excessive API calls.
 *
 * @param stxAddress - Stacks address to check
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns true if the agent has STX currently stacked, false otherwise
 */
export async function verifyStackerAchievement(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<boolean> {
  try {
    const cacheKey = `stacking:${stxAddress}`;
    let stackingData = await getCachedTransaction(cacheKey, kv);

    if (!stackingData) {
      const stackingUrl = `https://api.hiro.so/extended/v1/address/${stxAddress}/stacking`;
      const stackingResp = await fetch(stackingUrl, {
        headers: buildHiroHeaders(hiroApiKey),
        signal: AbortSignal.timeout(10000),
      });

      if (stackingResp.status === 404) {
        // 404 means no stacking data — not stacking
        return false;
      }

      if (!stackingResp.ok) {
        console.error(
          `Failed to fetch stacking data for ${stxAddress}: ${stackingResp.status}`
        );
        return false;
      }

      stackingData = (await stackingResp.json()) as { locked: string };
      await setCachedTransaction(cacheKey, stackingData, kv);
    }

    const locked = parseInt((stackingData as { locked: string }).locked ?? "0", 10);
    return locked > 0;
  } catch (error) {
    console.error(`Failed to verify stacker achievement for ${stxAddress}:`, error);
    return false;
  }
}

/**
 * Verify if an agent holds any sBTC balance (sBTC Holder achievement).
 *
 * Checks the Stacks Extended API balances endpoint for a non-zero sBTC
 * SIP-010 fungible token balance. Uses KV cache with 5-minute TTL.
 *
 * @param stxAddress - Stacks address to check
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns true if the agent holds any sBTC, false otherwise
 */
export async function verifysBtcHolderAchievement(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<boolean> {
  try {
    const cacheKey = `sbtc-balance:${stxAddress}`;
    let balanceData = await getCachedTransaction(cacheKey, kv);

    if (!balanceData) {
      const balanceUrl = `https://api.hiro.so/extended/v1/address/${stxAddress}/balances`;
      const balanceResp = await fetch(balanceUrl, {
        headers: buildHiroHeaders(hiroApiKey),
        signal: AbortSignal.timeout(10000),
      });

      if (!balanceResp.ok) {
        console.error(
          `Failed to fetch balances for ${stxAddress}: ${balanceResp.status}`
        );
        return false;
      }

      balanceData = await balanceResp.json();
      await setCachedTransaction(cacheKey, balanceData, kv);
    }

    const fungibleTokens = (
      balanceData as {
        fungible_tokens?: Record<string, { balance: string }>;
      }
    ).fungible_tokens ?? {};
    const sBtcKey =
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
    const sBtcBalance = fungibleTokens[sBtcKey]?.balance ?? "0";
    return parseInt(sBtcBalance, 10) > 0;
  } catch (error) {
    console.error(
      `Failed to verify sbtc-holder achievement for ${stxAddress}:`,
      error
    );
    return false;
  }
}
