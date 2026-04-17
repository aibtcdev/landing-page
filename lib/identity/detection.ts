/**
 * ERC-8004 identity detection utilities
 */

import { uintCV } from "@stacks/transactions";
import { IDENTITY_REGISTRY_CONTRACT, STACKS_API_BASE } from "./constants";
import { callReadOnly, parseClarityValue, buildHiroHeaders } from "./stacks-api";
import { stacksApiFetch } from "../stacks-api-fetch";
import type { AgentIdentity } from "./types";
import {
  getCachedIdentity,
  setCachedIdentity,
  setCachedIdentityNegative,
  setCachedIdentityLookupFailed,
} from "./kv-cache";
import type { Logger } from "../logging";

/**
 * Tri-state identity lookup outcome.
 *
 * - `"positive"` — Hiro returned a matching NFT; `identity` is populated.
 * - `"confirmed-negative"` — Hiro authoritatively returned no match.
 * - `"lookup-failed"` — transient upstream error (429/5xx/timeout/parse) or
 *   incomplete legacy scan. We don't know whether the address owns one.
 *
 * Callers that mirror lookup results into persistent storage (e.g. the
 * refresh endpoint) should skip the write on `"lookup-failed"` — overwriting
 * a verified `erc8004AgentId` with `null` during a Hiro incident would
 * corrupt the AgentRecord.
 */
export type IdentityLookupOutcome =
  | { state: "positive"; identity: AgentIdentity }
  | { state: "confirmed-negative"; identity: null }
  | { state: "lookup-failed"; identity: null };

/**
 * Detect identity NFT ownership and return the tri-state outcome.
 *
 * Use {@link detectAgentIdentity} for callers that only need
 * `AgentIdentity | null`.
 */
export async function detectAgentIdentityWithOutcome(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<IdentityLookupOutcome> {
  // Check KV cache first (distinguishes miss from cached negative result)
  const cached = await getCachedIdentity(stxAddress, kv, logger);
  if (cached.hit) {
    if (cached.value) {
      return { state: "positive", identity: cached.value };
    }
    // Cached NONE_SENTINEL. As with BNS, we can't distinguish
    // confirmed-negative from lookup-failed from the cached value alone —
    // callers that care should bust the cache first (see refresh endpoint).
    return { state: "confirmed-negative", identity: null };
  }

  try {
    // Query NFT holdings for this address filtered to the identity registry contract.
    // This is O(1) instead of O(N) — a single API call regardless of total NFTs minted.
    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-identity`;
    const holdingsUrl = `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    const headers = buildHiroHeaders(hiroApiKey);
    // Reduced retry budget for synchronous profile lookups: worst-case ~13s
    // instead of default ~71s. Primary NFT holdings call gets retries429=1 (1s max
    // 429 delay) and retries=2 (1.5s max 5xx delay).
    const response = await stacksApiFetch(holdingsUrl, { headers }, {
      retries: 2,
      retries429: 1,
      logger,
    });

    if (!response.ok) {
      // Fallback to legacy scan if holdings API fails (e.g. 404, 500)
      logger?.warn("identity.holdings_api_failed_falling_back", {
        stxAddress,
        status: response.status,
      });
      return await detectAgentIdentityLegacyWithOutcome(
        stxAddress,
        hiroApiKey,
        kv,
        logger
      );
    }

    const data = await response.json() as {
      total: number;
      results: Array<{
        asset_identifier: string;
        value: { repr: string; hex: string };
        tx_id: string;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      // No identity NFT found for this address — cache negative to skip future Hiro API calls
      await setCachedIdentityNegative(stxAddress, kv, logger);
      return { state: "confirmed-negative", identity: null };
    }

    // Extract the token ID from the value repr (format: "u42" for uint 42)
    const nft = data.results[0];
    const tokenIdMatch = nft.value.repr.match(/^u(\d+)$/);
    if (!tokenIdMatch) {
      // Parse/format failure does not prove the address has no identity NFT,
      // so do not negative-cache this result. Classify as lookup-failed so
      // refresh-style callers don't clobber the stored agentId.
      logger?.warn("identity.parse_token_id_failed", { repr: nft.value.repr });
      return { state: "lookup-failed", identity: null };
    }
    const agentId = Number(tokenIdMatch[1]);

    // Fetch the token URI (best-effort — identity is valid even without URI)
    let uri = "";
    try {
      const uriResult = await callReadOnly(
        IDENTITY_REGISTRY_CONTRACT,
        "get-token-uri",
        [uintCV(agentId)],
        hiroApiKey,
        logger
      );
      uri = parseClarityValue(uriResult, logger) || "";
    } catch (error) {
      logger?.warn("identity.fetch_token_uri_failed", {
        agentId,
        error: String(error),
      });
    }

    const identity: AgentIdentity = { agentId, owner: stxAddress, uri };
    await setCachedIdentity(stxAddress, identity, kv, logger);
    return { state: "positive", identity };
  } catch (error) {
    // Network timeout / abort / JSON parse failure. Short-TTL negative-cache
    // so the retry storm doesn't keep hammering Hiro for the same address.
    logger?.error("identity.detect_error", {
      stxAddress,
      error: String(error),
    });
    await setCachedIdentityLookupFailed(stxAddress, kv, logger);
    return { state: "lookup-failed", identity: null };
  }
}

/**
 * Detect if an agent has registered an on-chain identity.
 *
 * Returns the identity or null (both confirmed-negative and lookup-failed
 * collapse to null). Use {@link detectAgentIdentityWithOutcome} when you
 * need to distinguish those two cases.
 *
 * @param stxAddress - Stacks address to check
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @param kv - Optional KV namespace for persistent caching
 * @param logger - Optional Logger for cache telemetry and error logging
 */
export async function detectAgentIdentity(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<AgentIdentity | null> {
  const outcome = await detectAgentIdentityWithOutcome(
    stxAddress,
    hiroApiKey,
    kv,
    logger
  );
  return outcome.identity;
}

/**
 * Legacy O(N) scan — used only as fallback if the holdings API is unavailable.
 * Capped at MAX_LEGACY_BATCHES to prevent unbounded Hiro API consumption.
 */
async function detectAgentIdentityLegacyWithOutcome(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<IdentityLookupOutcome> {
  logger?.warn("identity.legacy_scan_fallback", { stxAddress });

  // Cap at 1 batch (5 get-owner calls) to bound worst-case Hiro API consumption.
  // If the target agent's identity NFT was minted outside the most recent 5 IDs,
  // we return lookup-failed without caching so the next request will try again.
  const MAX_LEGACY_BATCHES = 1;

  const lastIdResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-last-token-id", [], hiroApiKey, logger);
  const lastIdRaw = parseClarityValue(lastIdResult, logger);
  const lastId = lastIdRaw !== null ? Number(lastIdRaw) : null;

  if (lastId === null || lastId < 0) {
    // Couldn't determine last token id — lookup is inconclusive.
    return { state: "lookup-failed", identity: null };
  }

  const BATCH_SIZE = 5;
  let batchCount = 0;
  for (let i = lastId; i >= 0; i -= BATCH_SIZE) {
    batchCount++;
    const batchStart = Math.max(0, i - BATCH_SIZE + 1);
    const batch = Array.from(
      { length: i - batchStart + 1 },
      (_, j) => i - j
    );
    const results = await Promise.all(
      batch.map(async (id) => {
        const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [
          uintCV(id),
        ], hiroApiKey, logger);
        return { id, owner: parseClarityValue(ownerResult, logger) };
      })
    );
    const match = results.find((r) => r.owner === stxAddress);
    if (match) {
      const uriResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-token-uri", [
        uintCV(match.id),
      ], hiroApiKey, logger);
      const uri = parseClarityValue(uriResult, logger);
      const identity: AgentIdentity = { agentId: match.id, owner: match.owner!, uri: uri || "" };
      await setCachedIdentity(stxAddress, identity, kv, logger);
      return { state: "positive", identity };
    }
    if (batchCount >= MAX_LEGACY_BATCHES) {
      // Scan is intentionally incomplete — don't negative-cache since the identity
      // may exist beyond the batches we checked. Classify as lookup-failed.
      logger?.warn("identity.legacy_scan_cap_hit", {
        stxAddress,
        batches: MAX_LEGACY_BATCHES,
        batchSize: BATCH_SIZE,
      });
      return { state: "lookup-failed", identity: null };
    }
  }

  // Exhausted all NFTs without finding a match — cache confirmed-negative.
  await setCachedIdentityNegative(stxAddress, kv, logger);
  return { state: "confirmed-negative", identity: null };
}

/**
 * Check if an agent ID exists (has been minted)
 */
export async function hasIdentity(
  agentId: number,
  hiroApiKey?: string,
  logger?: Logger
): Promise<boolean> {
  try {
    const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [uintCV(agentId)], hiroApiKey, logger);
    const owner = parseClarityValue(ownerResult, logger);
    return owner !== null;
  } catch (error) {
    logger?.error("identity.has_identity_error", {
      agentId,
      error: String(error),
    });
    return false;
  }
}
