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
 * Verify if an agent has inscribed a soul document on Bitcoin L1 (Inscriber achievement).
 *
 * Accepts an inscription ID (format: {txid}i{index}, e.g. "abc123...i0") submitted by the agent.
 * Uses Unisat API to verify:
 * 1. The inscription exists and is currently owned by btcAddress
 * 2. The inscription content is text-based (soul documents are text/plain or text/markdown)
 *
 * @param btcAddress - Bitcoin address to check ownership against
 * @param inscriptionId - Ordinal inscription ID (64-char txid + "i" + output index)
 * @param kv - Cloudflare KV namespace for caching
 * @param unisatApiKey - Optional Unisat API key for authenticated requests
 * @returns Object with verified flag and optional reason string
 */
export async function verifyInscriberAchievement(
  btcAddress: string,
  inscriptionId: string,
  kv: KVNamespace,
  unisatApiKey?: string
): Promise<{ verified: boolean; reason?: string }> {
  try {
    const cacheKey = `unisat-inscription:${inscriptionId}`;

    type UnisatInscriptionInfo = {
      inscriptionId: string;
      address: string;
      contentType: string;
      contentLength: number;
    };

    let info: UnisatInscriptionInfo | null = await getCachedTransaction(
      cacheKey,
      kv
    );

    if (!info) {
      const url = `https://open-api.unisat.io/v1/indexer/inscription/info/${inscriptionId}`;
      const headers: HeadersInit = { Accept: "application/json" };
      if (unisatApiKey) {
        headers["Authorization"] = `Bearer ${unisatApiKey}`;
      }

      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        return {
          verified: false,
          reason: `Unisat API error: ${resp.status} ${resp.statusText}`,
        };
      }

      const json = (await resp.json()) as {
        code: number;
        msg: string;
        data: UnisatInscriptionInfo;
      };

      if (json.code !== 0 || !json.data) {
        return {
          verified: false,
          reason: `Inscription not found: ${json.msg}`,
        };
      }

      info = json.data;
      await setCachedTransaction(cacheKey, info, kv);
    }

    // Verify ownership
    if (info.address !== btcAddress) {
      return {
        verified: false,
        reason: `Inscription ${inscriptionId} is owned by ${info.address}, not ${btcAddress}`,
      };
    }

    // Verify content is text-based (soul documents are text/plain or text/markdown)
    const contentType = info.contentType ?? "";
    if (!contentType.startsWith("text/")) {
      return {
        verified: false,
        reason: `Inscription content type "${contentType}" is not a text document`,
      };
    }

    return { verified: true };
  } catch (error) {
    console.error(
      `Failed to verify inscriber achievement for ${btcAddress}:`,
      error
    );
    return {
      verified: false,
      reason: `Verification error: ${(error as Error).message}`,
    };
  }
}
