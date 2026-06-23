/**
 * AIBTC Legion dashboard — on-chain constants.
 *
 * The Legion contracts live on Stacks *testnet*, deliberately separate from the
 * rest of the platform (which reads mainnet). All reads here are public
 * read-only calls; no key is required for testnet.
 */

import { STACKS_API_TESTNET_BASE } from "../identity/constants";

export const LEGION_API_BASE = STACKS_API_TESTNET_BASE;
export const LEGION_CHAIN = "testnet";

// v3.0 Phase-1 deploy (legion-agent-03). Supersedes the agent-02 2-contract
// deploy (ST38Y96G…): adds legion-fees, Rail-A prechecks on propose, bond-lock,
// unstake, and proposer-exclusion (quorum measured against eligible stake).
export const LEGION_DEPLOYER = "STBEMQQVSS3K3SQTF2NRZMF82JHMNTHQKQ2J7DW5";

export const TREASURY_CONTRACT = `${LEGION_DEPLOYER}.legion-treasury`;
export const GOV_CONTRACT = `${LEGION_DEPLOYER}.legion-gov`;
/** Protocol fee collector — 8% skim of routed sBTC into the treasury. */
export const FEES_CONTRACT = `${LEGION_DEPLOYER}.legion-fees`;

/** sBTC SIP-010 token on testnet (8 decimals). */
export const SBTC_TOKEN = "STV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RJ5XDY2.sbtc-token";
export const SBTC_DECIMALS = 8;

/** Governance "constitution" — display-only rules. */
export const GOV_RULES = {
  quorumPct: 15,
  thresholdPct: 66,
  minVoters: 2,
  vetoPct: 15,
} as const;

/**
 * KV key for the cron-built snapshot (VERIFIED_AGENTS namespace). The dashboard
 * reads this; the cron writes it. Decouples Hiro read volume from page traffic.
 */
export const LEGION_SNAPSHOT_KV_KEY = "legion:snapshot";

/** Testnet explorer link for an address. */
export function explorerAddressUrl(address: string): string {
  return `https://explorer.hiro.so/address/${address}?chain=${LEGION_CHAIN}`;
}

/** Testnet explorer link for a contract id (`addr.name`). */
export function explorerContractUrl(contractId: string): string {
  return `https://explorer.hiro.so/txid/${contractId}?chain=${LEGION_CHAIN}`;
}

/** Testnet explorer link for a transaction id. */
export function explorerTxUrl(txid: string): string {
  return `https://explorer.hiro.so/txid/${txid}?chain=${LEGION_CHAIN}`;
}
