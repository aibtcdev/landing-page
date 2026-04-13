/**
 * Shared agent profile enrichment.
 *
 * Fetches identity, reputation, achievements, check-in data, claim status,
 * and inbox metrics for an agent in parallel with a timeout guard.
 *
 * Used by /api/agents/[address] and /api/resolve/[identifier] to avoid
 * duplicating the same enrichment logic in both route handlers.
 */

import type { AgentRecord, ClaimStatus } from "@/lib/types";
import type { AgentIdentity, ReputationSummary } from "@/lib/identity/types";
import type { AchievementRecord } from "@/lib/achievements";
import { getAgentLevel, type AgentLevelInfo } from "@/lib/levels";
import { getAgentAchievements } from "@/lib/achievements";
import { getCheckInRecord, type CheckInRecord } from "@/lib/heartbeat";
import { detectAgentIdentity, getReputationSummary } from "@/lib/identity";
import { getAgentInbox, getSentIndex } from "@/lib/inbox/kv-helpers";
import { getCAIP19AgentId } from "@/lib/caip19";

/** Timeout for all enrichment fetches (identity, reputation, achievements, inbox). */
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
  checkInCount: number;
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
  achievements: AchievementRecord[];
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
 * Enrich an agent record with identity, reputation, achievements, check-in,
 * claim status, and inbox data. All fetches run in parallel with a timeout
 * guard so a slow Hiro API does not block the response.
 *
 * @param agent - The agent record to enrich
 * @param kv - Cloudflare KV namespace
 * @param hiroApiKey - Optional Hiro API key for authenticated Stacks API requests
 * @param logPrefix - Prefix for timeout warning logs (e.g. "agents/bc1q...")
 * @returns Enrichment result with all derived metrics
 */
export async function enrichAgentProfile(
  agent: AgentRecord,
  kv: KVNamespace,
  hiroApiKey?: string,
  logPrefix?: string
): Promise<EnrichmentResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const enrichmentTimeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(
        `[${logPrefix ?? agent.btcAddress}] Enrichment timed out after ${ENRICHMENT_TIMEOUT_MS}ms — returning partial response`
      );
      resolve(null);
    }, ENRICHMENT_TIMEOUT_MS);
  });

  // Fetch claim, achievements, check-in, identity+reputation, inbox, and sent index in parallel.
  // Identity and reputation are combined into a single slot so reputation starts immediately
  // after identity resolves, without blocking the other parallel fetches.
  const enrichmentResult = await Promise.race([
    Promise.all([
      kv.get(`claim:${agent.btcAddress}`),
      getAgentAchievements(kv, agent.btcAddress),
      getCheckInRecord(kv, agent.btcAddress),
      fetchIdentityAndReputation(agent, hiroApiKey, kv),
      getAgentInbox(kv, agent.btcAddress),
      getSentIndex(kv, agent.btcAddress),
    ]).finally(() => clearTimeout(timeoutId)),
    enrichmentTimeout,
  ]);

  // Destructure enrichment result; fall back to empty values on timeout
  const [
    claimData,
    achievements,
    checkInRecord,
    identityAndReputation,
    inboxIndex,
    sentIndex,
  ] = enrichmentResult ?? [
    null,
    [],
    null,
    { identity: null, reputation: null },
    null,
    null,
  ];

  const identity = identityAndReputation?.identity ?? null;
  const reputation = identityAndReputation?.reputation ?? null;

  const claim = parseClaim(claimData, agent.btcAddress);
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
    checkInCount: (checkInRecord?.checkInCount ?? agent.checkInCount) ?? 0,
    hasCheckedIn: !!checkInRecord,
    hasInboxMessages: !!inboxIndex,
    unreadInboxCount: inboxIndex?.unreadCount ?? 0,
    sentCount: sentIndex?.messageIds.length ?? 0,
  };

  const capabilities = deriveCapabilities(levelInfo.level, agent, identity);

  return {
    levelInfo,
    claim,
    identity,
    reputation,
    achievements,
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
  kv: KVNamespace
): Promise<{ identity: AgentIdentity | null; reputation: ReputationSummary | null }> {
  // Use cached agent-id if available; agent-id 0 is valid (falsy) so use != null.
  // When using the cached shortcut, uri is "" because fetching it would require
  // an additional on-chain call — the agentId is sufficient for reputation lookups.
  const identityResult: AgentIdentity | null =
    agent.erc8004AgentId != null
      ? { agentId: agent.erc8004AgentId, owner: agent.stxAddress, uri: "" }
      : await detectAgentIdentity(agent.stxAddress, hiroApiKey, kv);

  if (!identityResult) return { identity: null, reputation: null };

  let reputation: ReputationSummary | null = null;
  try {
    reputation = await getReputationSummary(identityResult.agentId, hiroApiKey, kv);
  } catch (e) {
    console.error(
      `Failed to fetch reputation for agent ${agent.btcAddress}:`,
      e
    );
  }
  return { identity: identityResult, reputation };
}

/** Parse a raw KV claim string into a ClaimStatus, or null on miss/error. */
function parseClaim(
  claimData: string | null,
  btcAddress: string
): ClaimStatus | null {
  if (!claimData) return null;
  try {
    return JSON.parse(claimData) as ClaimStatus;
  } catch (e) {
    console.error(`Failed to parse claim for ${btcAddress}:`, e);
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
