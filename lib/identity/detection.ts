/**
 * ERC-8004 identity detection utilities
 */

import { uintCV } from "@stacks/transactions";
import { IDENTITY_REGISTRY_CONTRACT, STACKS_API_BASE } from "./constants";
import { callReadOnly, parseClarityValue, buildHiroHeaders } from "./stacks-api";
import { stacksApiFetch } from "../stacks-api-fetch";
import type { AgentIdentity } from "./types";
import { getCachedIdentity, setCachedIdentity } from "./kv-cache";

/**
 * Detect if an agent has registered an on-chain identity.
 *
 * Uses the Hiro NFT holdings API to find identity NFTs owned by the
 * address in a single request, instead of scanning all token IDs.
 *
 * @param stxAddress - Stacks address to check
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @param kv - Optional KV namespace for persistent caching
 */
export async function detectAgentIdentity(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<AgentIdentity | null> {
  // Check KV cache first
  const cached = await getCachedIdentity(stxAddress, kv);
  if (cached) return cached;

  try {
    // Query NFT holdings for this address filtered to the identity registry contract.
    // This is O(1) instead of O(N) — a single API call regardless of total NFTs minted.
    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-id`;
    const holdingsUrl = `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    const headers = buildHiroHeaders(hiroApiKey);
    const response = await stacksApiFetch(holdingsUrl, { headers });

    if (!response.ok) {
      // Fallback to legacy scan if holdings API fails (e.g. 404, 500)
      console.warn(`NFT holdings API returned ${response.status}, falling back to legacy scan`);
      return await detectAgentIdentityLegacy(stxAddress, hiroApiKey, kv);
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
      // No identity NFT found for this address
      return null;
    }

    // Extract the token ID from the value repr (format: "u42" for uint 42)
    const nft = data.results[0];
    const tokenIdMatch = nft.value.repr.match(/^u(\d+)$/);
    if (!tokenIdMatch) {
      console.warn("Could not parse NFT token ID from repr:", nft.value.repr);
      return null;
    }
    const agentId = Number(tokenIdMatch[1]);

    // Fetch the token URI
    const uriResult = await callReadOnly(
      IDENTITY_REGISTRY_CONTRACT,
      "get-token-uri",
      [uintCV(agentId)],
      hiroApiKey
    );
    const uri = parseClarityValue(uriResult);

    const identity: AgentIdentity = { agentId, owner: stxAddress, uri: uri || "" };
    // Cache the result
    await setCachedIdentity(stxAddress, identity, kv);
    return identity;
  } catch (error) {
    console.error("Error detecting agent identity:", error);
    return null;
  }
}

/**
 * Legacy O(N) scan — used only as fallback if the holdings API is unavailable.
 */
async function detectAgentIdentityLegacy(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<AgentIdentity | null> {
  const lastIdResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-last-token-id", [], hiroApiKey);
  const lastIdRaw = parseClarityValue(lastIdResult);
  const lastId = lastIdRaw !== null ? Number(lastIdRaw) : null;

  if (lastId === null || lastId < 0) return null;

  const BATCH_SIZE = 5;
  for (let i = lastId; i >= 0; i -= BATCH_SIZE) {
    const batchStart = Math.max(0, i - BATCH_SIZE + 1);
    const batch = Array.from(
      { length: i - batchStart + 1 },
      (_, j) => i - j
    );
    const results = await Promise.all(
      batch.map(async (id) => {
        const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [
          uintCV(id),
        ], hiroApiKey);
        return { id, owner: parseClarityValue(ownerResult) };
      })
    );
    const match = results.find((r) => r.owner === stxAddress);
    if (match) {
      const uriResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-token-uri", [
        uintCV(match.id),
      ], hiroApiKey);
      const uri = parseClarityValue(uriResult);
      const identity: AgentIdentity = { agentId: match.id, owner: match.owner!, uri: uri || "" };
      await setCachedIdentity(stxAddress, identity, kv);
      return identity;
    }
  }

  return null;
}

/**
 * Check if an agent ID exists (has been minted)
 */
export async function hasIdentity(agentId: number, hiroApiKey?: string): Promise<boolean> {
  try {
    const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [uintCV(agentId)], hiroApiKey);
    const owner = parseClarityValue(ownerResult);
    return owner !== null;
  } catch (error) {
    console.error("Error checking identity existence:", error);
    return false;
  }
}
