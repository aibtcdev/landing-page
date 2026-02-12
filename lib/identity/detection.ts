/**
 * ERC-8004 identity detection utilities
 */

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
    const lastId = parseClarityValue(lastIdResult);

    if (lastId === null || lastId < 0) {
      // No NFTs minted yet
      return null;
    }

    // Search through all token IDs to find one owned by this address
    // Note: This is inefficient for large numbers of agents
    // In production, consider using an indexer or event logs
    for (let agentId = 0; agentId <= lastId; agentId++) {
      const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [
        `u${agentId}`,
      ]);
      const owner = parseClarityValue(ownerResult);

      if (owner === stxAddress) {
        // Found a match! Get the URI
        const uriResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-token-uri", [
          `u${agentId}`,
        ]);
        const uri = parseClarityValue(uriResult);

        return {
          agentId,
          owner,
          uri: uri || "",
        };
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
    const ownerResult = await callReadOnly(IDENTITY_REGISTRY_CONTRACT, "get-owner", [`u${agentId}`]);
    const owner = parseClarityValue(ownerResult);
    return owner !== null;
  } catch (error) {
    console.error("Error checking identity existence:", error);
    return false;
  }
}
