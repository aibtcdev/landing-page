/**
 * ERC-8004 contract addresses and constants
 */

export const IDENTITY_REGISTRY_CONTRACT =
  "SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2";

export const REPUTATION_REGISTRY_CONTRACT =
  "SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.reputation-registry-v2";

export const STACKS_API_BASE = "https://api.mainnet.hiro.so";

export const WAD_DECIMALS = 18;

/**
 * Cache TTL for identity checks (1 hour)
 * Used by heartbeat and identity endpoints to prevent excessive on-chain queries
 */
export const IDENTITY_CHECK_TTL_MS = 60 * 60 * 1000;
