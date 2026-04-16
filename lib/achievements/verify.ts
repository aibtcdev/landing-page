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
import {
  buildHiroHeaders,
  callReadOnly,
  parseClarityValue,
} from "@/lib/identity/stacks-api";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE } from "@/lib/identity/constants";
import { standardPrincipalCV } from "@stacks/transactions";

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

/** sBTC SIP-010 contract on mainnet. */
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

/**
 * Verify if an agent holds a non-zero sBTC balance (sBTC Holder achievement).
 *
 * Calls the `get-balance` read-only function on the sBTC SIP-010 contract.
 * Uses KV cache with 5-minute TTL to avoid excessive API calls.
 *
 * @param stxAddress - Stacks address to check
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns true if the agent holds any sBTC, false otherwise
 */
export async function verifySbtcHolderAchievement(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<boolean> {
  try {
    const cacheKey = `sbtc-balance:${stxAddress}`;
    let balanceData = await getCachedTransaction(cacheKey, kv);

    if (!balanceData) {
      const response = await callReadOnly(
        SBTC_CONTRACT,
        "get-balance",
        [standardPrincipalCV(stxAddress)],
        hiroApiKey
      );

      const parsed = parseClarityValue(response);
      if (parsed === null) {
        // Transient API failure — don't cache a false "0", allow retry next time
        return false;
      }
      balanceData = { balance: parsed };
      await setCachedTransaction(cacheKey, balanceData, kv);
    }

    const balance = (balanceData as { balance: string }).balance ?? "0";
    return balance !== "0" && balance !== "";
  } catch (error) {
    console.error(
      `Failed to verify sbtc-holder achievement for ${stxAddress}:`,
      error
    );
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
      const stackingUrl = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/stacking`;
      const stackingResp = await stacksApiFetch(stackingUrl, {
        headers: buildHiroHeaders(hiroApiKey),
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

/**
 * Verify if an inscription belongs to the given Bitcoin address (Inscriber achievement).
 *
 * Queries the Unisat Ordinals indexer to check that the inscription's current owner
 * matches btcAddress. Uses KV cache with 5-minute TTL to avoid excessive API calls.
 *
 * @param inscriptionId - Inscription ID to verify (e.g., "abc123i0")
 * @param btcAddress - Bitcoin address that should own the inscription
 * @param kv - Cloudflare KV namespace
 * @param unisatApiKey - Unisat API key (Bearer token)
 * @returns true if the inscription is owned by btcAddress, false otherwise
 */
/**
 * sBTC token contract identifier used for connector achievement verification.
 */
const SBTC_CONTRACT_ID =
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

/**
 * Verify if an agent has sent an sBTC transfer with memo to a registered agent (Connector achievement).
 *
 * Scans the agent's recent Stacks transactions for qualifying sBTC transfers.
 * A qualifying transfer must:
 * - Be a successful contract_call to sbtc-token transfer
 * - Have the agent as the sender (via function args, to support relay-mediated txs)
 * - Have a registered agent as the recipient
 * - Include a memo
 *
 * @param stxAddress - Agent's Stacks address
 * @param kv - Cloudflare KV namespace (to check recipient registration)
 * @param hiroApiKey - Optional Hiro API key for higher rate limits
 * @returns Object with qualifying txid and recipientAddress, or null if none found
 */
export async function verifyConnectorAchievement(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey?: string
): Promise<{ txid: string; recipientAddress: string } | null> {
  try {
    const cacheKey = `stx-txs:${stxAddress}`;
    let txs = await getCachedTransaction(cacheKey, kv);

    if (!txs) {
      const txsUrl = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/transactions?limit=50`;
      const resp = await stacksApiFetch(txsUrl, {
        headers: buildHiroHeaders(hiroApiKey),
      });

      if (!resp.ok) {
        console.error(
          `Failed to fetch transactions for ${stxAddress}: ${resp.status}`
        );
        return null;
      }

      const data = (await resp.json()) as {
        results: Array<{
          tx_id: string;
          tx_status: string;
          tx_type: string;
          sender_address: string;
          contract_call?: {
            contract_id: string;
            function_name: string;
            function_args?: Array<{ name: string; repr: string }>;
          };
        }>;
      };
      txs = data.results;
      await setCachedTransaction(cacheKey, txs, kv);
    }

    // Find a qualifying sBTC transfer
    for (const tx of txs as Array<{
      tx_id: string;
      tx_status: string;
      tx_type: string;
      sender_address: string;
      contract_call?: {
        contract_id: string;
        function_name: string;
        function_args?: Array<{ name: string; repr: string }>;
      };
    }>) {
      if (tx.tx_status !== "success") continue;
      if (tx.tx_type !== "contract_call") continue;
      if (!tx.contract_call) continue;
      if (tx.contract_call.contract_id !== SBTC_CONTRACT_ID) continue;
      if (tx.contract_call.function_name !== "transfer") continue;

      const args = tx.contract_call.function_args;
      if (!args) continue;

      // Check sender arg matches agent (supports relay-mediated transfers)
      const senderArg = args.find((a) => a.name === "sender");
      if (!senderArg) continue;
      const senderAddress = senderArg.repr.replace(/^'/, "");
      if (senderAddress !== stxAddress) continue;

      // Check memo is present
      const memoArg = args.find((a) => a.name === "memo");
      if (!memoArg || memoArg.repr.includes("none")) continue;

      // Check recipient is a registered agent
      const recipientArg = args.find((a) => a.name === "recipient");
      if (!recipientArg) continue;
      const recipientAddress = recipientArg.repr.replace(/^'/, "");

      const recipientData = await kv.get(`stx:${recipientAddress}`);
      if (!recipientData) continue;

      return { txid: tx.tx_id, recipientAddress };
    }

    return null;
  } catch (error) {
    console.error(
      `Failed to verify connector achievement for ${stxAddress}:`,
      error
    );
    return null;
  }
}

const INSCRIPTION_ID_RE = /^[a-fA-F0-9]{64}i\d+$/;

export async function verifyInscriberAchievement(
  inscriptionId: string,
  btcAddress: string,
  kv: KVNamespace,
  unisatApiKey?: string
): Promise<boolean> {
  try {
    if (!INSCRIPTION_ID_RE.test(inscriptionId)) {
      console.error(`Invalid inscriptionId format: ${inscriptionId}`);
      return false;
    }

    const cacheKey = `unisat-inscription:${inscriptionId}`;
    let inscriptionData = await getCachedTransaction(cacheKey, kv);

    if (!inscriptionData) {
      const url = `https://open-api.unisat.io/v1/indexer/inscription/info/${inscriptionId}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (unisatApiKey) {
        headers["Authorization"] = `Bearer ${unisatApiKey}`;
      }

      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        console.error(
          `Failed to fetch inscription ${inscriptionId} from Unisat: ${resp.status}`
        );
        return false;
      }

      inscriptionData = (await resp.json()) as {
        code: number;
        data?: { address?: string };
      };
      await setCachedTransaction(cacheKey, inscriptionData, kv);
    }

    if (inscriptionData.code !== 0 || !inscriptionData.data?.address) {
      return false;
    }

    return inscriptionData.data.address === btcAddress;
  } catch (error) {
    console.error(`Failed to verify inscriber achievement for ${inscriptionId}:`, error);
    return false;
  }
}
