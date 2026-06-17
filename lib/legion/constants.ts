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

export const LEGION_DEPLOYER = "STXGASYJR80W8RWNM7R4ENRJAPR75Y5W57J57V0J";

export const TREASURY_CONTRACT = `${LEGION_DEPLOYER}.legion-treasury`;
export const GOV_CONTRACT = `${LEGION_DEPLOYER}.legion-gov`;
export const PAYOUT_CONTRACT = `${LEGION_DEPLOYER}.legion-payout`;

/** sBTC SIP-010 token on testnet (8 decimals). */
export const SBTC_TOKEN = "STV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RJ5XDY2.sbtc-token";
export const SBTC_DECIMALS = 8;

/** The ten known legion agents (label → address). */
export const LEGION_AGENTS: ReadonlyArray<{ label: string; address: string }> = [
  { label: "legion-agent-01", address: "STXGASYJR80W8RWNM7R4ENRJAPR75Y5W57J57V0J" },
  { label: "legion-agent-02", address: "ST38Y96G7WHWSWY7JTE3DVM77EBCA86WX63HY9HPV" },
  { label: "legion-agent-03", address: "STBEMQQVSS3K3SQTF2NRZMF82JHMNTHQKQ2J7DW5" },
  { label: "legion-agent-04", address: "ST2KVMAENJ1V64YKT722HNQRPRR0W1A4JDA8KW8A4" },
  { label: "legion-agent-05", address: "ST2VN1G6EBXPMMAJKCSY1HR50YQCVFSK68KKP9SKW" },
  { label: "legion-agent-06", address: "STGX5YP51NKM69ZMP6DVB6GAJAANCG5WB3718KD9" },
  { label: "legion-agent-07", address: "ST34Q5MVC410NTEK8G00G2QZ1JTBB2WJTNABTE6RA" },
  { label: "legion-agent-08", address: "ST1QQ1NJMM3MH73X2W2DD7K9K2G9CHW00D9FVX7PD" },
  { label: "legion-agent-09", address: "STH2TAB1VE615MXSQ3HSXVACC2ZEEM0EBY1V8GCK" },
  { label: "legion-agent-10", address: "ST2BEBZJ8Y2H6F5DK9KC450238Y3HGJCS9B7P2JD3" },
] as const;

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

/** Maps a known agent address to its label, or null if not a legion agent. */
export function legionLabelFor(address: string): string | null {
  return LEGION_AGENTS.find((a) => a.address === address)?.label ?? null;
}

/** Testnet explorer link for an address. */
export function explorerAddressUrl(address: string): string {
  return `https://explorer.hiro.so/address/${address}?chain=${LEGION_CHAIN}`;
}

/** Testnet explorer link for a contract id (`addr.name`). */
export function explorerContractUrl(contractId: string): string {
  return `https://explorer.hiro.so/txid/${contractId}?chain=${LEGION_CHAIN}`;
}
