/**
 * ERC-8004 identity detection utilities
 */

import { uintCV } from "@stacks/transactions";
import { IDENTITY_REGISTRY_CONTRACT } from "./constants";
import { callReadOnly, parseClarityValue } from "./stacks-api";
import type { AgentIdentity } from "./types";

/**
 * Detect if an agent has registered an on-chain identity
 * Searches for an NFT owned by the given Stacks address
 */
export async function detectAgentIdentity(
  stxAddress: string
): Promise<AgentIdentity | null> {
  try {
    // First, get the last token ID to know the range
    const lastIdResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-last-token-id", []);
    const lastIdRaw = parseClarityValue(lastIdResult);

    // parseClarityValue returns uint values as strings
    const lastId = lastIdRaw !== null ? Number(lastIdRaw) : null;

    if (lastId === null || lastId < 0) {
      // No NFTs minted yet
      return null;
    }

    // Search from highest ID downward so we return the most recent identity
    // when an address owns multiple (e.g. stale test mint + intended registration)
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
          ]);
          return { id, owner: parseClarityValue(ownerResult) };
        })
      );
      const match = results.find((r) => r.owner === stxAddress);
      if (match) {
        const uriResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-token-uri", [
          uintCV(match.id),
        ]);
        const uri = parseClarityValue(uriResult);
        return { agentId: match.id, owner: match.owner!, uri: uri || "" };
      }
    }

    // No match found
    return null;
  } catch (error) {
    console.error("Error detecting agent identity:", error);
    return null;
  }
}

/**
 * Check if an agent ID exists (has been minted)
 */
export async function hasIdentity(agentId: number): Promise<boolean> {
  try {
    const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [uintCV(agentId)]);
    const owner = parseClarityValue(ownerResult);
    return owner !== null;
  } catch (error) {
    console.error("Error checking identity existence:", error);
    return false;
  }
}
