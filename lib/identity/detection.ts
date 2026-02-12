/**
 * ERC-8004 identity detection utilities
 */

import {
  IDENTITY_REGISTRY_CONTRACT,
  STACKS_API_BASE,
} from "./constants";
import type { AgentIdentity } from "./types";

/**
 * Call a read-only function on the identity registry contract
 */
async function callReadOnly(
  functionName: string,
  args: string[]
): Promise<any> {
  const [contractAddress, contractName] =
    IDENTITY_REGISTRY_CONTRACT.split(".");
  const url = `${STACKS_API_BASE}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: contractAddress,
      arguments: args,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Stacks API call failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data;
}

/**
 * Parse a Clarity value from the API response
 */
function parseClarityValue(result: any): any {
  if (!result || !result.okay) {
    return null;
  }

  const value = result.result;

  // Handle different Clarity types
  if (value.type === "uint") {
    return parseInt(value.value, 10);
  }

  if (value.type === "int") {
    return parseInt(value.value, 10);
  }

  if (value.type === "principal") {
    return value.value;
  }

  if (value.type === "string-utf8" || value.type === "string-ascii") {
    return value.value;
  }

  if (value.type === "optional") {
    if (value.value === null || value.value.type === "none") {
      return null;
    }
    return parseClarityValue({ okay: true, result: value.value });
  }

  if (value.type === "response") {
    if (value.value.success) {
      return parseClarityValue({ okay: true, result: value.value.value });
    }
    return null;
  }

  return null;
}

/**
 * Detect if an agent has registered an on-chain identity
 * Searches for an NFT owned by the given Stacks address
 */
export async function detectAgentIdentity(
  stxAddress: string
): Promise<AgentIdentity | null> {
  try {
    // First, get the last token ID to know the range
    const lastIdResult = await callReadOnly("get-last-token-id", []);
    const lastId = parseClarityValue(lastIdResult);

    if (lastId === null || lastId < 0) {
      // No NFTs minted yet
      return null;
    }

    // Search through all token IDs to find one owned by this address
    // Note: This is inefficient for large numbers of agents
    // In production, consider using an indexer or event logs
    for (let agentId = 0; agentId <= lastId; agentId++) {
      const ownerResult = await callReadOnly("get-owner", [
        `u${agentId}`,
      ]);
      const owner = parseClarityValue(ownerResult);

      if (owner === stxAddress) {
        // Found a match! Get the URI
        const uriResult = await callReadOnly("get-token-uri", [
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
    const ownerResult = await callReadOnly("get-owner", [`u${agentId}`]);
    const owner = parseClarityValue(ownerResult);
    return owner !== null;
  } catch (error) {
    console.error("Error checking identity existence:", error);
    return false;
  }
}
