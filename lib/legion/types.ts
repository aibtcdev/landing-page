/**
 * Legion dashboard data model. All sBTC amounts are integer satoshis
 * (divide by 1e8 for display). Block heights are Stacks block numbers.
 */

import type { LegionKind } from "./constants";

/**
 * A registry entry — one Legion as listed by `legion-registry.get-legion(id)`,
 * normalized for our use. `id` is the registry's numeric id as a string, or the
 * reserved slug `"demand"` for the known-but-unregistered demand Legion.
 */
export interface LegionEntry {
  id: string;
  kind: LegionKind;
  /** Deployer / admin principal. */
  owner: string;
  /** `{owner}.legion-treasury` — shared by both kinds. */
  treasury: string;
  /** Governance contract — present for demand Legions, null for provider. */
  gov: string | null;
  /** Fee collector — usually present (8% skim → treasury). */
  fees: string | null;
  /** `{owner}.legion-providers` — present for provider Legions only. */
  providers: string | null;
  /** Advertised model, e.g. "qwen2.5-7b" (provider) or "" (demand). */
  model: string;
  /** Human label from the registry `uri` field. */
  uri: string;
  active: boolean;
  /** Where this entry came from: the on-chain registry, or our constant fallback. */
  source: "registry" | "fallback";
}

/**
 * Compact per-Legion row for the `/legions` index. `count` is #providers for a
 * provider Legion or #proposals for a demand Legion; `treasuryBalance` is sats.
 */
export interface LegionSummary {
  id: string;
  kind: LegionKind;
  owner: string;
  model: string;
  uri: string;
  active: boolean;
  /** Pooled sBTC (sats), or null if the read failed. */
  treasuryBalance: number | null;
  /** #providers (provider) or #proposals (demand), or null if unread. */
  count: number | null;
  /**
   * Explicit contract ids from the registry so the detail page can resolve a
   * Legion from the cached index without a Hiro round-trip. Needed now that
   * per-model legions use suffixed names (legion-{treasury,gov,fees}-<model>)
   * under one owner — the `{owner}.legion-*` convention no longer holds.
   * Optional for back-compat with snapshots written before this field existed.
   */
  treasury?: string;
  gov?: string | null;
  fees?: string | null;
  source: "registry" | "fallback";
}

/** The `/legions` index snapshot — the registry list, cron-built. */
export interface RegistrySnapshot {
  updatedAt: number;
  legions: LegionSummary[];
  /** Per-read failure notes; partial lists are still served. */
  errors: string[];
}

/**
 * One inference provider in a provider Legion. In v1 providers join the gateway
 * for **free** (`GET /v1/providers` on the inference gateway) — there is no bond
 * and no slash. The optional on-chain `legion-engage` stake only buys ranking.
 */
export interface ProviderRecord {
  /** Provider STX payout address (joins to `legion-engage get-stake`). */
  address: string;
  /** Human label from the gateway directory, e.g. "biwas qwen model". */
  name: string;
  /** Model this provider serves, e.g. "Qwen/Qwen2.5-7B-Instruct". */
  model: string;
  /** Advertised inference endpoint URL. */
  endpoint: string;
  /** Optional engagement stake (sats) from `legion-engage`; 0 if unstaked. */
  stake: number;
  /** Gateway health status ("up" | "down" | "unknown"). */
  health: string;
  /** Operator-flagged (de-routed everywhere); enforcement is flag, not slash. */
  flagged: boolean;
  /** Live + routable: not flagged and healthy. */
  active: boolean;
}

/** Detail snapshot for a provider Legion (mirrors LegionSnapshot for demand). */
export interface ProviderSnapshot {
  /** Unix ms when assembled. */
  updatedAt: number;
  blockHeight: number | null;
  /** The registry entry this snapshot was built from. */
  entry: LegionEntry;
  /** Pooled sBTC (sats), or null on read failure. */
  treasuryBalance: number | null;
  /** Minimum engagement stake to rank (sats) from `legion-engage`, or null. */
  minStake: number | null;
  /** Total sBTC staked across all members (sats) from `legion-engage`, or null. */
  totalStaked: number | null;
  /** Providers sorted by stake descending (mirrors the gateway's rankByStake). */
  providers: ProviderRecord[];
  errors: string[];
}

export interface LegionMember {
  /** STX address (also the staker / voter identity). */
  address: string;
  /** Staked sBTC (sats) = voting weight. */
  stake: number;
  /** stake / totalStaked * 100, in [0, 100]. */
  weightPct: number;
  /** Wallet sBTC balance (sats), independent of stake. */
  sbtcBalance: number;
}

export interface LegionVote {
  /** Voter STX address. */
  address: string;
  /** true = YES, false = NO. */
  vote: boolean;
  /** Weight committed with the vote (sats). */
  amount: number;
  /** The on-chain `vote` transaction id (null if not recovered). */
  txid: string | null;
}

export interface LegionProposalStatus {
  createdBtc: number;
  voteStart: number;
  voteEnd: number;
  execStart: number;
  execEnd: number;
  yesWeight: number;
  noWeight: number;
  vetoWeight: number;
  totalStakedSnapshot: number;
  voterCount: number;
  metQuorum: boolean;
  metThreshold: boolean;
  vetoMetQuorum: boolean;
  vetoActivated: boolean;
  concluded: boolean;
  executed: boolean;
}

export interface LegionProposal {
  id: number;
  /** Who created the proposal. */
  proposer: string;
  desc: string;
  /** Who the treasury pays if the proposal passes. */
  recipient: string;
  /** Payout amount from the treasury (sats). */
  amount: number;
  status: LegionProposalStatus;
  /** The agents who actually voted, derived from on-chain vote txs. */
  votes: LegionVote[];
}

export interface LegionTreasury {
  /** Pooled sBTC (sats). null if the read failed. */
  balance: number | null;
  govWired: boolean;
  tokenWired: boolean;
}

export interface LegionSnapshot {
  /** Unix ms when this snapshot was assembled. */
  updatedAt: number;
  /**
   * The registry entry this snapshot was built from. Optional for back-compat
   * with snapshots written before multi-Legion; readers fall back to the demand
   * constants when absent.
   */
  entry?: LegionEntry;
  /** Stacks tip height at snapshot time. null if /v2/info failed. */
  blockHeight: number | null;
  treasury: LegionTreasury;
  /** Total staked across the legion (sats). null if the read failed. */
  totalStaked: number | null;
  /** Members sorted by stake descending. */
  members: LegionMember[];
  /** Proposals, newest first. */
  proposals: LegionProposal[];
  /** Per-read failure notes — present so partial outages are visible, not silent. */
  errors: string[];
}
