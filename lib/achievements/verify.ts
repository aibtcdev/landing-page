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

/** Regex patterns that must all match for content to qualify as a soul document */
const SOUL_DOCUMENT_MARKERS = [
  /^#\s+\w+/m, // Markdown H1 heading (agent name)
  /identity/i, // Identity section reference
  /bitcoin|stacks|btc|stx/i, // Blockchain reference
];

/**
 * Verify if an agent has inscribed a soul document on Bitcoin L1 (Inscriber achievement).
 *
 * Accepts an inscription ID (format: {txid}i{index}, e.g. "abc123...i0") submitted by the agent.
 * Uses Unisat API to verify:
 * 1. The inscription exists and is currently held by btcAddress
 * 2. The inscription content is text-based (soul documents are text/plain or text/markdown)
 * 3. The content matches soul document format (SOUL.md markers)
 *
 * @param btcAddress - Bitcoin address to verify as current inscription holder
 * @param inscriptionId - Ordinals inscription ID (format: {txid}i{index})
 * @param kv - Cloudflare KV namespace for caching
 * @param unisatApiKey - Optional Unisat API key (required for production; free tier: 5 req/s)
 * @returns Object with verified flag and optional error message
 */
export async function verifyInscriberAchievement(
  btcAddress: string,
  inscriptionId: string,
  kv: KVNamespace,
  unisatApiKey?: string
): Promise<{ verified: boolean; error?: string }> {
  try {
    const cacheKey = `unisat-inscription:${inscriptionId}`;

    type InscriptionInfo = {
      inscriptionId: string;
      address: string;
      contentType: string;
      contentLength: number;
      contentBody?: string;
    };

    let info = await getCachedTransaction(cacheKey, kv) as InscriptionInfo | null;

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
          error: `Unisat API error: ${resp.status} ${resp.statusText}`,
        };
      }

      const json = (await resp.json()) as {
        code: number;
        msg: string;
        data: InscriptionInfo;
      };

      if (json.code !== 0 || !json.data) {
        return {
          verified: false,
          error: `Inscription not found: ${json.msg}`,
        };
      }

      info = json.data;
      await setCachedTransaction(cacheKey, info, kv);
    }

    // Verify the inscription is currently held by the submitting address
    if (info.address !== btcAddress) {
      return {
        verified: false,
        error: `Inscription ${inscriptionId} is held by ${info.address}, not ${btcAddress}`,
      };
    }

    // Verify content type is text (soul documents are text/plain or text/markdown)
    const contentType = info.contentType ?? "";
    if (!contentType.startsWith("text/")) {
      return {
        verified: false,
        error: `Inscription content type must be text/* (found: ${contentType})`,
      };
    }

    // Use contentBody from info if available, otherwise fetch from ordinals
    let content = info.contentBody;
    if (!content) {
      const contentUrl = `https://ordinals.com/content/${inscriptionId}`;
      const contentResp = await fetch(contentUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!contentResp.ok) {
        return {
          verified: false,
          error: `Failed to fetch inscription content: ${contentResp.status}`,
        };
      }
      content = await contentResp.text();
    }

    // Validate content contains soul document markers
    const isSoulDocument = SOUL_DOCUMENT_MARKERS.every((marker) =>
      marker.test(content!)
    );
    if (!isSoulDocument) {
      return {
        verified: false,
        error:
          "Inscription content does not match soul document format (must be a SOUL.md-formatted identity document)",
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
      error: `Verification failed: ${(error as Error).message}`,
    };
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

    const locked = (stackingData as { locked: string }).locked ?? "0";
    return locked !== "0" && locked !== "";
  } catch (error) {
    console.error(`Failed to verify stacker achievement for ${stxAddress}:`, error);
    return false;
  }
}
