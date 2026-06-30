/**
 * AIBTC Legion dashboard — on-chain constants.
 *
 * The Legion contracts live on Stacks *testnet*, deliberately separate from the
 * rest of the platform (which reads mainnet). All reads here are public
 * read-only calls; no key is required for testnet.
 *
 * The platform is now **multi-Legion**: a shared on-chain `legion-registry`
 * lists every Legion (see REGISTRY_CONTRACT). Per-Legion contract addresses come
 * from the registry entry, not from constants — the single demand deploy below
 * is kept only as a known fallback so `/legions` lists it even before it is
 * registered on-chain.
 */

import { STACKS_API_TESTNET_BASE } from "../identity/constants";

export const LEGION_API_BASE = STACKS_API_TESTNET_BASE;
export const LEGION_CHAIN = "testnet";

/**
 * The directory. Read this first: `get-count` → uint, then `get-legion(id)` →
 * `(optional { owner, kind, treasury, gov, fees, model, uri, active })`. Every
 * other per-Legion address is discovered from a registry entry.
 */
export const REGISTRY_CONTRACT =
  "STXGASYJR80W8RWNM7R4ENRJAPR75Y5W57J57V0J.legion-registry";

// v3.0 Phase-1 demand deploy (legion-agent-03). Supersedes the agent-02
// 2-contract deploy (ST38Y96G…): adds legion-fees, Rail-A prechecks on propose,
// bond-lock, unstake, and proposer-exclusion (quorum measured against eligible
// stake). NOT yet in the registry — surfaced via the fallback demand entry.
export const LEGION_DEPLOYER = "STBEMQQVSS3K3SQTF2NRZMF82JHMNTHQKQ2J7DW5";

export const TREASURY_CONTRACT = `${LEGION_DEPLOYER}.legion-treasury`;
export const GOV_CONTRACT = `${LEGION_DEPLOYER}.legion-gov`;
/** Protocol fee collector — 8% skim of routed sBTC into the treasury. */
export const FEES_CONTRACT = `${LEGION_DEPLOYER}.legion-fees`;

/**
 * Reserved id for the known demand Legion in our routing (`/legions/demand`).
 * It is not numerically in the registry yet, so a string slug avoids colliding
 * with the registry's numeric ids ("1", "2", …).
 */
export const DEMAND_LEGION_ID = "demand";

/** The two Legion kinds. `demand` governs a treasury; `provider` serves models. */
export type LegionKind = "demand" | "provider";

/**
 * Both kinds share `legion-treasury` + `legion-fees`. They differ in the third
 * contract: demand uses `legion-gov` (proposals/voting); provider uses
 * `legion-providers` (bonds/members). The registry stores treasury/gov/fees but
 * not the providers contract, so derive it by convention from the owner.
 *
 * Kept for back-compat (registry entry shape); v1 no longer reads it for the
 * provider list — see `legionEngageContract` + the gateway directory.
 */
export function legionProvidersContract(owner: string): string {
  return `${owner}.legion-providers`;
}

/**
 * v1 engagement-stake contract for a provider Legion. Staking is OPTIONAL and
 * never required to earn — it only buys ranking. Not stored in the registry, so
 * derived by convention from the owner (only legions whose owner deployed one
 * will resolve; reads are best-effort and degrade to "unstaked").
 */
export function legionEngageContract(owner: string): string {
  return `${owner}.legion-engage`;
}

/**
 * Base URL of the inference gateway whose `GET /v1/providers` directory backs
 * the v1 provider list (free-join providers + health + flag status). This
 * gateway serves testnet, so its provider payout addresses match the testnet
 * `legion-engage` stakes. Overridable per-env via the optional
 * `LEGION_GATEWAY_URL` Worker var if the gateway ever moves.
 */
export const DEFAULT_LEGION_GATEWAY_URL = "https://inference.aibtc.com";

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
