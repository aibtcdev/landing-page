/**
 * D1-backed single-agent profile lookup (Phase 2.2).
 *
 * Replaces per-request KV fan-out (btc:, stx:, claim:, erc8004 variants)
 * with a single D1 SELECT + LEFT JOIN on claims.
 *
 * Resolver branches handled here:
 *   1. BTC address (bc1q*, 1*, 3*)                         → WHERE btc_address = ?
 *   2. STX address (SP*, ST*)                              → WHERE stx_address = ?
 *   3. ERC-8004 agent-id (numeric)                        → WHERE erc8004_agent_id = ?
 *   4. Taproot (bc1p*) as reverse-lookup path              → KV taproot:{addr} → btc_address → WHERE btc_address = ?
 *   5. BNS name                                            → lib/bns resolution → stx_address → WHERE stx_address = ?
 *
 * Taproot and BNS resolution (branches 4+5) still use KV for the reverse-lookup
 * step — those KV keys are not being migrated in Phase 2.2. Only the final
 * agent-record fetch flips to D1.
 */

import type { AgentRecord, ClaimStatus, ClaimRecord } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";

/**
 * D1 row shape from the profile SELECT (agents + LEFT JOIN claims).
 * Column names match D1 schema exactly (snake_case).
 */
export interface AgentProfileRow {
  // agents columns
  btc_address: string;
  stx_address: string;
  stx_public_key: string;
  btc_public_key: string;
  taproot_address: string | null;
  display_name: string | null;
  description: string | null;
  bns_name: string | null;
  owner: string | null;
  verified_at: string;
  last_active_at: string | null;
  erc8004_agent_id: number | null;
  nostr_public_key: string | null;
  capabilities_json: string | null;
  last_identity_check: string | null;
  referred_by_btc: string | null;
  referral_code: string;
  github_username: string | null;
  // claims columns (LEFT JOIN — all nullable on miss)
  claim_status: string | null;
  tweet_url: string | null;
  tweet_author: string | null;
  claimed_at: string | null;
  reward_satoshis: number | null;
  reward_txid: string | null;
}

/**
 * Map a D1 profile row to an AgentRecord compatible with the enrichment pipeline.
 *
 * The returned AgentRecord is shape-compatible with the KV-sourced AgentRecord
 * used by enrichAgentProfile(), so the enrichment pipeline needs no changes.
 */
export function mapRowToAgentRecord(row: AgentProfileRow): AgentRecord {
  return {
    btcAddress: row.btc_address,
    stxAddress: row.stx_address,
    stxPublicKey: row.stx_public_key,
    btcPublicKey: row.btc_public_key,
    taprootAddress: row.taproot_address,
    displayName: row.display_name ?? undefined,
    description: row.description,
    bnsName: row.bns_name,
    owner: row.owner,
    verifiedAt: row.verified_at,
    lastActiveAt: row.last_active_at ?? undefined,
    erc8004AgentId: row.erc8004_agent_id,
    nostrPublicKey: row.nostr_public_key,
    // capabilities_json is stored as a JSON array string; parse if present
    capabilities: row.capabilities_json
      ? (() => {
          try {
            return JSON.parse(row.capabilities_json!) as string[];
          } catch {
            return null;
          }
        })()
      : null,
    lastIdentityCheck: row.last_identity_check ?? undefined,
    referredBy: row.referred_by_btc ?? undefined,
    githubUsername: row.github_username,
  };
}

/**
 * Map the claims columns from a D1 profile row to a ClaimRecord, or null on LEFT JOIN miss.
 *
 * claim_status being null means the LEFT JOIN found no matching claim row.
 */
export function mapRowToClaimRecord(row: AgentProfileRow): ClaimRecord | null {
  if (row.claim_status === null) return null;
  return {
    btcAddress: row.btc_address,
    // display_name comes from the claims table per schema, but the JOIN
    // doesn't select it to avoid ambiguity with agents.display_name.
    // Use agents.display_name as the best-effort fallback.
    displayName: row.display_name ?? "",
    tweetUrl: row.tweet_url ?? "",
    tweetAuthor: row.tweet_author,
    claimedAt: row.claimed_at ?? "",
    rewardSatoshis: row.reward_satoshis ?? 0,
    rewardTxid: row.reward_txid,
    status: row.claim_status as ClaimRecord["status"],
  };
}

/**
 * Derive a minimal ClaimStatus from a ClaimRecord for level computation.
 */
export function claimRecordToStatus(claim: ClaimRecord): ClaimStatus {
  return {
    status: claim.status,
    claimedAt: claim.claimedAt,
    rewardSatoshis: claim.rewardSatoshis,
    rewardTxid: claim.rewardTxid,
  };
}

/**
 * Compute level and level name from an agent record + optional claim.
 */
export function computeProfileLevel(
  agent: AgentRecord,
  claim: ClaimRecord | null
): { level: number; levelName: string } {
  const claimStatus = claim ? claimRecordToStatus(claim) : null;
  const level = computeLevel(agent, claimStatus);
  return { level, levelName: LEVELS[level].name };
}

/**
 * The SQL SELECT used for profile lookups.
 * Parameterized with a WHERE clause supplied by the caller.
 * Uses a placeholder __WHERE__ that the caller replaces with the actual
 * predicate string before preparing.
 *
 * NOTE: claims.display_name is intentionally excluded to avoid ambiguity
 * with agents.display_name — the profile shape uses agents.display_name.
 */
export const PROFILE_SELECT_SQL = `
SELECT
  a.btc_address,
  a.stx_address,
  a.stx_public_key,
  a.btc_public_key,
  a.taproot_address,
  a.display_name,
  a.description,
  a.bns_name,
  a.owner,
  a.verified_at,
  a.last_active_at,
  a.erc8004_agent_id,
  a.nostr_public_key,
  a.capabilities_json,
  a.last_identity_check,
  a.referred_by_btc,
  a.referral_code,
  a.github_username,
  c.status      AS claim_status,
  c.tweet_url,
  c.tweet_author,
  c.claimed_at,
  c.reward_satoshis,
  c.reward_txid
FROM agents a
LEFT JOIN claims c ON c.btc_address = a.btc_address
WHERE __WHERE__
LIMIT 1
`.trim();

/** Resolver branch identifiers (for logging and test assertions). */
export type ResolverBranch = "btc" | "stx" | "numeric" | "taproot" | "bns";

/**
 * Determine the address shape and resolver branch from a raw address string.
 *
 * Returns null for unrecognized formats.
 */
export function classifyAddress(address: string): ResolverBranch | null {
  // Numeric → erc8004_agent_id
  if (/^\d+$/.test(address)) return "numeric";

  // Taproot (bc1p*) — must check before btc (bc1q also starts with bc1)
  if (address.startsWith("bc1p")) return "taproot";

  // BTC (bc1q*, 1*, 3*)
  if (
    address.startsWith("bc1") ||
    address.startsWith("1") ||
    address.startsWith("3")
  ) {
    return "btc";
  }

  // STX mainnet (SP*) or testnet (ST*)
  if (address.startsWith("SP") || address.startsWith("ST")) return "stx";

  // Also handle SM (Stacks mainnet legacy)
  if (address.startsWith("SM")) return "stx";

  // BNS name
  if (address.endsWith(".btc")) return "bns";

  return null;
}

/**
 * Look up an agent profile row from D1 by BTC address (branch 1 / taproot resolved).
 */
export async function lookupProfileByBtcAddress(
  db: D1Database,
  btcAddress: string
): Promise<AgentProfileRow | null> {
  const sql = PROFILE_SELECT_SQL.replace(
    "__WHERE__",
    "a.btc_address = ?"
  );
  const result = await db.prepare(sql).bind(btcAddress).first<AgentProfileRow>();
  return result ?? null;
}

/**
 * Look up an agent profile row from D1 by STX address (branch 2 / BNS resolved).
 */
export async function lookupProfileByStxAddress(
  db: D1Database,
  stxAddress: string
): Promise<AgentProfileRow | null> {
  const sql = PROFILE_SELECT_SQL.replace(
    "__WHERE__",
    "a.stx_address = ?"
  );
  const result = await db.prepare(sql).bind(stxAddress).first<AgentProfileRow>();
  return result ?? null;
}

/**
 * Look up an agent profile row from D1 by ERC-8004 agent-id (branch 3).
 */
export async function lookupProfileByAgentId(
  db: D1Database,
  agentId: number
): Promise<AgentProfileRow | null> {
  const sql = PROFILE_SELECT_SQL.replace(
    "__WHERE__",
    "a.erc8004_agent_id = ?"
  );
  const result = await db.prepare(sql).bind(agentId).first<AgentProfileRow>();
  return result ?? null;
}
