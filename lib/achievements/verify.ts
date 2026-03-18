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

/** Minimum content length (chars) to qualify as a soul document */
const SOUL_MIN_LENGTH = 200;

/**
 * Check if text content resembles a soul.md document.
 *
 * A valid soul document must have:
 * - An H1 heading (# Name) as the primary identifier
 * - At least one H2 subheading (## Section) indicating structure
 * - Minimum content length to rule out trivial inscriptions
 */
function isSoulDocument(content: string): boolean {
  const hasH1 = /^#\s+\S+/m.test(content);
  const hasH2 = /^##\s+\S+/m.test(content);
  return hasH1 && hasH2 && content.length >= SOUL_MIN_LENGTH;
}

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
 * Verify if an agent inscribed a soul document on Bitcoin L1 (Inscriber achievement).
 *
 * Checks two things:
 * 1. The inscription is owned by the agent's Bitcoin address (via Unisat API)
 * 2. The inscription content matches soul.md format (H1 + H2 headings, min length)
 *
 * @param btcAddress - Bitcoin address that should own the inscription
 * @param inscriptionId - Ordinals inscription ID (e.g. "abc123...i0")
 * @param kv - Cloudflare KV namespace
 * @param unisatApiKey - Unisat API key for authenticated requests
 * @returns Object with verified flag and optional error message
 */
export async function verifyInscriberAchievement(
  btcAddress: string,
  inscriptionId: string,
  kv: KVNamespace,
  unisatApiKey?: string
): Promise<{ verified: boolean; error?: string }> {
  try {
    // 1. Verify inscription ownership via Unisat API
    const cacheKey = `unisat-inscription:${inscriptionId}`;
    type UnisatInscriptionInfo = {
      address: string;
      contentType: string;
    };

    let inscriptionInfo = await getCachedTransaction(
      cacheKey,
      kv
    ) as UnisatInscriptionInfo | null;

    if (!inscriptionInfo) {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (unisatApiKey) {
        headers["Authorization"] = `Bearer ${unisatApiKey}`;
      }

      const infoUrl = `https://open-api.unisat.io/v1/indexer/inscription/info/${inscriptionId}`;
      const infoResp = await fetch(infoUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!infoResp.ok) {
        return {
          verified: false,
          error: `Unisat API error: ${infoResp.status} ${infoResp.statusText}`,
        };
      }

      const json = (await infoResp.json()) as {
        code: number;
        msg: string;
        data: UnisatInscriptionInfo;
      };

      if (json.code !== 0) {
        return { verified: false, error: `Unisat error: ${json.msg}` };
      }

      inscriptionInfo = json.data;
      await setCachedTransaction(cacheKey, inscriptionInfo, kv);
    }

    if (inscriptionInfo.address !== btcAddress) {
      return {
        verified: false,
        error: `Inscription is owned by ${inscriptionInfo.address}, not ${btcAddress}`,
      };
    }

    // 2. Fetch inscription content from ordinals.com (public, no auth)
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

    const content = await contentResp.text();

    if (!isSoulDocument(content)) {
      return {
        verified: false,
        error:
          "Inscription content does not match soul.md format (requires H1 heading, H2 sections, minimum length)",
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
