/**
 * CAIP-19 Asset Identifier utilities for AIBTC agents.
 *
 * CAIP-19 is a standard for identifying blockchain assets.
 * Reference: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-19.md
 *
 * Format for Stacks SIP-009 NFTs:
 *   stacks:1/sip009:{contractAddress}/{tokenId}
 *
 * Example for identity-registry-v2 agent #42:
 *   stacks:1/sip009:SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2/42
 */

import { IDENTITY_REGISTRY_CONTRACT } from "@/lib/identity/constants";

/**
 * CAIP-2 chain identifier for Stacks mainnet.
 * Format: namespace:reference
 */
export const CAIP19_CHAIN_ID = "stacks:1";

/**
 * CAIP-19 asset namespace for SIP-009 NFTs (Stacks equivalent of ERC-721).
 */
export const CAIP19_ASSET_TYPE = "sip009";

/**
 * Build a CAIP-19 identifier for an agent's ERC-8004 identity NFT.
 *
 * @param agentId - The sequential agent ID (token ID) assigned at registration
 * @returns CAIP-19 asset identifier string
 *
 * @example
 * buildCAIP19AgentId(42)
 * // => "stacks:1/sip009:SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2/42"
 */
export function buildCAIP19AgentId(agentId: number): string {
  return `${CAIP19_CHAIN_ID}/${CAIP19_ASSET_TYPE}:${IDENTITY_REGISTRY_CONTRACT}/${agentId}`;
}

/**
 * Get a CAIP-19 identifier for an agent, or null if no on-chain identity exists.
 *
 * Agents with an erc8004AgentId have registered on-chain via identity-registry-v2
 * and receive a CAIP-19 identifier for interoperability with other systems.
 *
 * Note: agentId 0 is valid (the first registered agent), so null/undefined checks
 * use explicit equality rather than truthiness.
 *
 * @param erc8004AgentId - Agent's on-chain token ID, or null/undefined if not registered
 * @returns CAIP-19 string if identity exists, null otherwise
 */
export function getCAIP19AgentId(
  erc8004AgentId: number | null | undefined
): string | null {
  if (erc8004AgentId == null) {
    return null;
  }
  return buildCAIP19AgentId(erc8004AgentId);
}
