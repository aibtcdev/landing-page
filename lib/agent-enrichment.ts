/**
 * Shared agent profile enrichment.
 *
 * Fetches identity, reputation, check-in data, claim status,
 * and inbox metrics for an agent in parallel with a timeout guard.
 *
 * Used by /api/agents/[address] and /api/resolve/[identifier] to avoid
 * duplicating the same enrichment logic in both route handlers.
 */

import type { AgentRecord, ClaimRecord, ClaimStatus } from "@/lib/types";
import type { AgentIdentity, ReputationSummary } from "@/lib/identity/types";
import { getAgentLevel, type AgentLevelInfo } from "@/lib/levels";
import { getCheckInRecord, type CheckInRecord } from "@/lib/heartbeat";
import { detectAgentIdentity, getReputationSummary } from "@/lib/identity";
import { getAgentInboxFromD1, getSentIndexFromD1 } from "@/lib/inbox/d1-reads";
import { getCAIP19AgentId } from "@/lib/caip19";
import type { Logger } from "@/lib/logging";

/** Timeout for all enrichment fetches (identity, reputation, inbox). */
const ENRICHMENT_TIMEOUT_MS = 10_000;

/** Trust metrics derived from identity and reputation data. */
export interface TrustMetrics {
  level: number;
  levelName: string;
  onChainIdentity: boolean;
  reputationScore: number | null;
  reputationCount: number;
}

/** Activity metrics derived from check-in and inbox data. */
export interface ActivityMetrics {
  lastActiveAt: string | null;
  hasCheckedIn: boolean;
  hasInboxMessages: boolean;
  unreadInboxCount: number;
  sentCount: number;
}

/** Full enrichment result returned by enrichAgentProfile(). */
export interface EnrichmentResult {
  levelInfo: AgentLevelInfo;
  claim: ClaimStatus | null;
  identity: AgentIdentity | null;
  reputation: ReputationSummary | null;
  checkIn: CheckInRecord | null;
  trust: TrustMetrics;
  activity: ActivityMetrics;
  capabilities: string[];
  /** Resolved agent ID (from identity detection or stored record). */
  resolvedAgentId: number | null;
  /** CAIP-19 identifier for the agent, or null if no on-chain identity. */
  caip19: string | null;
}

/**
 * Enrich an agent record with identity, reputation, check-in,
 * claim status, and inbox data. All fetches run in parallel with a timeout
 * guard so a slow Hiro API does not block the response.
 *
 * @param agent - The agent record to enrich
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for authenticated Stacks API requests
 * @param logPrefix - Prefix for timeout warning logs (e.g. "agents/bc1q...")
 * @param logger - Optional logger for telemetry
 * @param prefetchedClaim - Optional claim already fetched from D1 (skips the KV
 *   `claim:{btcAddress}` read when provided). Pass null to indicate "no claim"
 *   (same as a KV miss), or omit / pass undefined to preserve the existing
 *   KV-fetch behavior (backwards-compatible for callers without a D1 claim).
 * @param db - Optional D1 database binding. When provided, inbox/sent metrics
 *   are read from D1 (live counts). When undefined, inbox metrics return empty
 *   defaults (fail-open). Phase 2.5 #746 — replaces the frozen-at-Step-4
 *   KV inbox reads in agent-enrichment. See lib/inbox/d1-reads.ts.
 * @returns Enrichment result with all derived metrics
 */
export async function enrichAgentProfile(
  agent: AgentRecord,
  kv: KVNamespace,
  hiroApiKey?: string,
  logPrefix?: string,
  logger?: Logger,
  prefetchedClaim?: ClaimRecord | ClaimStatus | null,
  db?: D1Database
): Promise<EnrichmentResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const enrichmentTimeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      logger?.warn("enrichment.timed_out", {
        context: logPrefix ?? agent.btcAddress,
        timeoutMs: ENRICHMENT_TIMEOUT_MS,
      });
      resolve(null);
    }, ENRICHMENT_TIMEOUT_MS);
  });

  // If a prefetched claim was supplied by the caller (e.g. from a D1 SELECT that
  // already LEFT JOINed the claims table), skip the `claim:{btcAddress}` KV read.
  // undefined means "not provided" (fall back to KV fetch).
  // null means "caller confirmed no claim" (same as a KV miss).
  const hasPrefetchedClaim = prefetchedClaim !== undefined;

  // Fetch check-in, identity+reputation, inbox, and sent index in parallel.
  // Claim is either passed in (skips KV) or fetched from KV alongside the others.
  // Identity and reputation are combined into a single slot so reputation starts immediately
  // after identity resolves, without blocking the other parallel fetches.
  // Inbox + sent metrics use D1 reads when `db` is provided (phase 2.5 #746),
  // returning null/empty to fail-open when the binding is unavailable.
  const enrichmentResult = await Promise.race([
    Promise.all([
      hasPrefetchedClaim ? Promise.resolve(null) : kv.get(`claim:${agent.btcAddress}`),
      getCheckInRecord(kv, agent.btcAddress),
      fetchIdentityAndReputation(agent, hiroApiKey, kv, logger),
      getAgentInboxFromD1(db, agent.btcAddress),
      getSentIndexFromD1(db, agent.btcAddress),
    ]).finally(() => clearTimeout(timeoutId)),
    enrichmentTimeout,
  ]);

  // Destructure enrichment result; fall back to empty values on timeout
  const [
    claimData,
    checkInRecord,
    identityAndReputation,
    inboxSummary,
    sentSummary,
  ] = enrichmentResult ?? [
    null,
    null,
    { identity: null, reputation: null },
    null,
    null,
  ];

  const identity = identityAndReputation?.identity ?? null;
  const reputation = identityAndReputation?.reputation ?? null;

  // Resolve claim: use prefetched value when provided, otherwise parse KV data.
  // prefetchedClaim may be a ClaimRecord (from D1) or ClaimStatus (from a
  // direct caller) — both have a `status` field, so they're compatible for
  // level computation. parseClaim is only called on the raw KV string path.
  const claim: ClaimStatus | null = hasPrefetchedClaim
    ? (prefetchedClaim
        ? ({
            status: prefetchedClaim.status,
            claimedAt: prefetchedClaim.claimedAt,
            rewardSatoshis: prefetchedClaim.rewardSatoshis,
            // Pass through rewardTxid if present on the source shape; both
            // ClaimRecord and ClaimStatus have it as optional.
            ...("rewardTxid" in prefetchedClaim && prefetchedClaim.rewardTxid
              ? { rewardTxid: prefetchedClaim.rewardTxid }
              : {}),
          } as ClaimStatus)
        : null)
    : parseClaim(claimData, agent.btcAddress, logger);
  const levelInfo = getAgentLevel(agent, claim);
  const resolvedAgentId = identity?.agentId ?? agent.erc8004AgentId ?? null;

  const trust: TrustMetrics = {
    level: levelInfo.level,
    levelName: levelInfo.levelName,
    onChainIdentity: !!identity,
    reputationScore: reputation?.summaryValue ?? null,
    reputationCount: reputation?.count ?? 0,
  };

  const activity: ActivityMetrics = {
    lastActiveAt: agent.lastActiveAt ?? null,
    hasCheckedIn: !!checkInRecord,
    hasInboxMessages: !!inboxSummary,
    unreadInboxCount: inboxSummary?.unreadCount ?? 0,
    sentCount: sentSummary?.sentCount ?? 0,
  };

  const capabilities = deriveCapabilities(levelInfo.level, agent, identity);

  return {
    levelInfo,
    claim,
    identity,
    reputation,
    checkIn: checkInRecord,
    trust,
    activity,
    capabilities,
    resolvedAgentId,
    caip19: getCAIP19AgentId(resolvedAgentId),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch identity and reputation in a single sequential chain.
 * Reputation depends on identity (needs agentId), so they cannot be fully parallel.
 */
async function fetchIdentityAndReputation(
  agent: AgentRecord,
  hiroApiKey: string | undefined,
  kv: KVNamespace,
  logger?: Logger
): Promise<{ identity: AgentIdentity | null; reputation: ReputationSummary | null }> {
  // Use cached agent-id if available; agent-id 0 is valid (falsy) so use != null.
  // When using the cached shortcut, uri is "" because fetching it would require
  // an additional on-chain call — the agentId is sufficient for reputation lookups.
  const identityResult: AgentIdentity | null =
    agent.erc8004AgentId != null
      ? { agentId: agent.erc8004AgentId, owner: agent.stxAddress, uri: "" }
      : await detectAgentIdentity(agent.stxAddress, hiroApiKey, kv, logger);

  if (!identityResult) return { identity: null, reputation: null };

  let reputation: ReputationSummary | null = null;
  try {
    reputation = await getReputationSummary(identityResult.agentId, hiroApiKey, kv, logger);
  } catch (e) {
    logger?.error("enrichment.reputation_fetch_failed", {
      btcAddress: agent.btcAddress,
      error: String(e),
    });
  }
  return { identity: identityResult, reputation };
}

/** Parse a raw KV claim string into a ClaimStatus, or null on miss/error. */
function parseClaim(
  claimData: string | null,
  btcAddress: string,
  logger?: Logger
): ClaimStatus | null {
  if (!claimData) return null;
  try {
    return JSON.parse(claimData) as ClaimStatus;
  } catch (e) {
    logger?.error("enrichment.parse_claim_failed", {
      btcAddress,
      error: String(e),
    });
    return null;
  }
}

/** Derive capabilities from level, agent record, and identity. */
function deriveCapabilities(
  level: number,
  agent: AgentRecord,
  identity: AgentIdentity | null
): string[] {
  const capabilities: string[] = [];
  if (level >= 1) {
    capabilities.push("heartbeat");
  }
  if (agent.stxAddress) {
    capabilities.push("inbox");
    capabilities.push("x402");
  }
  if (identity) {
    capabilities.push("reputation");
  }
  return capabilities;
}
