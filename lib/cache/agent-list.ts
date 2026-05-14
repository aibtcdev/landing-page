/**
 * KV-backed cache for the enriched agent list.
 *
 * Replaces O(N) KV scans on every page load with a single KV read.
 * Uses a stale-while-revalidate pattern: cached data is kept for 10 minutes
 * (hard TTL) but considered fresh for only 2 minutes. Stale hits trigger a
 * background rebuild without blocking the response, so readers never see an
 * empty list just because another request happens to be rebuilding.
 *
 * Mutation endpoints call invalidateAgentListCache() to force a rebuild.
 *
 * Phase 2.1: rebuildAgentListCache body replaced with a single D1 SELECT +
 * LEFT JOIN claims + COUNT subqueries on inbox_messages. Zero KV reads on the
 * rebuild path (vs ~750 fan-out reads before).
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { computeLevel, LEVELS } from "@/lib/levels";
import type { CachedAgent, CachedAgentList } from "./types";

const CACHE_KEY = "cache:agent-list";
// Hard TTL — snapshot persists in KV well beyond its freshness window so we
// can always serve stale data while a rebuild happens in the background.
const CACHE_TTL_SECONDS = 600; // 10 minutes
// Freshness window — within this age from `cachedAt`, no rebuild is needed.
const FRESH_WINDOW_SECONDS = 120; // 2 minutes

// Sentinel key written during rebuild to prevent thundering herd.
const BUILDING_KEY = "cache:agent-list:building";
const BUILDING_TTL_SECONDS = 60;

// When there's no cache at all AND another request is already rebuilding,
// poll briefly for the rebuild to finish instead of returning an empty list.
const COLD_MISS_POLL_MS = 1500;
const COLD_MISS_POLL_INTERVAL_MS = 150;

type WaitUntil = (promise: Promise<unknown>) => void;

function isFresh(snapshot: CachedAgentList): boolean {
  const cachedAt = Date.parse(snapshot.cachedAt);
  if (Number.isNaN(cachedAt)) return false;
  return Date.now() - cachedAt < FRESH_WINDOW_SECONDS * 1000;
}

function parseSnapshot(raw: string | null): CachedAgentList | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedAgentList;
  } catch {
    return null;
  }
}

/**
 * Get the cached agent list from KV.
 *
 * - Fresh hit: return immediately.
 * - Stale hit: return the stale snapshot and kick off a background rebuild.
 *   If `waitUntil` is provided, the rebuild runs after the response is sent;
 *   otherwise it runs fire-and-forget (best-effort on Workers).
 * - Cold miss: if another request is already rebuilding, poll briefly so we
 *   can serve the fresh result instead of an empty list. Otherwise rebuild
 *   synchronously.
 *
 * @param kv - VERIFIED_AGENTS KV namespace (cache layer only; rebuild reads D1)
 * @param waitUntil - optional Cloudflare Workers waitUntil for background tasks
 */
export async function getCachedAgentList(
  kv: KVNamespace,
  waitUntil?: WaitUntil
): Promise<CachedAgentList> {
  const raw = await kv.get(CACHE_KEY);
  const cached = parseSnapshot(raw);

  // Corrupted entry — delete it so we don't keep hitting the parse failure
  // for the full 600s hard TTL.
  if (raw && !cached) {
    await kv.delete(CACHE_KEY).catch(() => {});
  }

  if (cached) {
    if (isFresh(cached)) return cached;

    // Stale — trigger a background rebuild but return what we have.
    const rebuild = maybeTriggerBackgroundRebuild(kv);
    if (waitUntil) waitUntil(rebuild);
    return cached;
  }

  // Cold miss. If someone else is rebuilding, wait for them rather than
  // either returning empty or piling on a duplicate O(N) rebuild.
  if (await kv.get(BUILDING_KEY)) {
    const waited = await pollForCache(kv);
    if (waited) return waited;
    // Rebuild didn't finish in time — fall through and rebuild ourselves
    // rather than show the user an empty page.
  }

  // Claim the rebuild with a sentinel (best-effort).
  try {
    await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
  } catch {
    // If sentinel write fails, proceed anyway — worst case is a duplicate rebuild
  }

  try {
    return await rebuildAgentListCache(kv);
  } finally {
    await kv.delete(BUILDING_KEY).catch(() => {});
  }
}

async function pollForCache(
  kv: KVNamespace
): Promise<CachedAgentList | null> {
  const deadline = Date.now() + COLD_MISS_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COLD_MISS_POLL_INTERVAL_MS));
    const snapshot = parseSnapshot(await kv.get(CACHE_KEY));
    if (snapshot) return snapshot;
  }
  return null;
}

async function maybeTriggerBackgroundRebuild(
  kv: KVNamespace
): Promise<void> {
  // Only one background rebuild at a time.
  if (await kv.get(BUILDING_KEY)) return;
  try {
    await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
  } catch {
    return;
  }
  try {
    await rebuildAgentListCache(kv);
  } catch {
    // Swallow — the stale snapshot is already being served.
  } finally {
    await kv.delete(BUILDING_KEY).catch(() => {});
  }
}

/**
 * Invalidate the cached agent list so the next read returns the stale
 * snapshot (and triggers a background rebuild) instead of forcing a
 * cold-miss synchronous rebuild.
 *
 * Mark-stale shifts cachedAt past FRESH_WINDOW_SECONDS but keeps the
 * snapshot inside CACHE_TTL_SECONDS, so getCachedAgentList sees it as
 * stale, returns it immediately, and kicks off maybeTriggerBackgroundRebuild.
 *
 * If there's no existing snapshot, this is a no-op (next read will cold-miss
 * + rebuild as before).
 */
export async function invalidateAgentListCache(
  kv: KVNamespace
): Promise<void> {
  try {
    const raw = await kv.get(CACHE_KEY);
    if (raw && !parseSnapshot(raw)) {
      // Corrupt entry — clean up immediately rather than leaving it for the
      // next getCachedAgentList call to find.
      await kv.delete(CACHE_KEY).catch(() => {});
      return;
    }
    const cached = parseSnapshot(raw);
    if (!cached) return;

    const stalePastFresh = new Date(
      Date.now() - (FRESH_WINDOW_SECONDS + 1) * 1000
    ).toISOString();

    // Optimistic re-check: if maybeTriggerBackgroundRebuild finished between
    // our read and now, skip the mark-stale put — the new snapshot is already
    // current and we'd otherwise clobber it with a stale-shifted S_old.
    const rawAgain = await kv.get(CACHE_KEY);
    const cachedAgain = parseSnapshot(rawAgain);
    if (cachedAgain && cachedAgain.cachedAt > cached.cachedAt) return;

    await kv.put(
      CACHE_KEY,
      JSON.stringify({ ...cached, cachedAt: stalePastFresh }),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  } catch {
    // Best-effort
  }
}

/**
 * D1 row shape returned by the agent-list SELECT.
 * Column names match the D1 schema exactly (snake_case).
 */
interface AgentListRow {
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
  last_identity_check: string | null;
  referred_by_btc: string | null;
  github_username: string | null;
  claim_status: string | null;
  claimed_at: string | null;
  message_count: number;
  unread_count: number;
}

/**
 * Map a single D1 row to a CachedAgent.
 *
 * level/levelName are computed via computeLevel() using a lightweight
 * AgentRecord + ClaimStatus reconstructed from the joined columns.
 */
export function mapRowToCachedAgent(row: AgentListRow): CachedAgent {
  // Reconstruct the minimal shapes that computeLevel() requires.
  // Full AgentRecord is not needed — computeLevel only checks agent existence
  // and claim.status being "verified" or "rewarded".
  const agentShape: Parameters<typeof computeLevel>[0] = {
    btcAddress: row.btc_address,
  } as Parameters<typeof computeLevel>[0];

  // claimed_at is NOT NULL by schema (migrations/002_claims.sql), so a non-null
  // claim_status implies a present claimed_at; guard on status alone to avoid
  // silently downgrading verified agents on hypothetical schema-violation rows.
  const claimShape =
    row.claim_status !== null
      ? ({
          status: row.claim_status as "pending" | "verified" | "rewarded" | "failed",
          claimedAt: row.claimed_at ?? "",
        } as Parameters<typeof computeLevel>[1])
      : null;

  const level = computeLevel(agentShape, claimShape);

  return {
    stxAddress: row.stx_address,
    btcAddress: row.btc_address,
    stxPublicKey: row.stx_public_key,
    btcPublicKey: row.btc_public_key,
    taprootAddress: row.taproot_address,
    displayName: row.display_name,
    description: row.description,
    bnsName: row.bns_name,
    owner: row.owner,
    verifiedAt: row.verified_at,
    lastActiveAt: row.last_active_at,
    erc8004AgentId: row.erc8004_agent_id,
    nostrPublicKey: row.nostr_public_key,
    lastIdentityCheck: row.last_identity_check,
    referredBy: row.referred_by_btc,
    githubUsername: row.github_username,
    level,
    levelName: LEVELS[level].name,
    messageCount: row.message_count,
    unreadCount: row.unread_count,
  };
}

/**
 * Rebuild the agent list cache from a single D1 SELECT.
 *
 * Phase 2.1 source-flip: replaces ~750 KV fan-out reads (btc:, claim:,
 * inbox:agent: per agent at ~250 agents) with one D1 query.
 *
 * The SELECT joins agents → claims (LEFT JOIN) and uses correlated
 * COUNT subqueries on inbox_messages for messageCount / unreadCount.
 * Results are ordered by verified_at DESC, matching the prior sort order.
 *
 * D1 binding is sourced from getCloudflareContext().env.DB to match the
 * existing pattern in all route files; no new binding parameter needed.
 */
async function rebuildAgentListCache(
  kv: KVNamespace
): Promise<CachedAgentList> {
  const { env } = await getCloudflareContext();
  const db = env.DB as D1Database;

  // P3 structural read flip: replaced two correlated COUNT(*) subqueries per
  // agent row with a single LEFT JOIN agent_inbox_stats. Previously each of
  // ~430 agents triggered two inbox_messages table scans (O(N × 2) → O(1 JOIN)).
  // COALESCE defaults to 0 for agents with no stats row (no messages yet).
  const result = await db
    .prepare(
      `SELECT
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
        a.last_identity_check,
        a.referred_by_btc,
        a.github_username,
        c.status   AS claim_status,
        c.claimed_at,
        COALESCE(s.received_count, 0) AS message_count,
        COALESCE(s.unread_count, 0)   AS unread_count
      FROM agents a
      LEFT JOIN claims c ON c.btc_address = a.btc_address
      LEFT JOIN agent_inbox_stats s ON s.btc_address = a.btc_address
      ORDER BY a.verified_at DESC`
    )
    .all<AgentListRow>();

  // Surface D1 errors to worker-logs — without this, a binding misconfig or
  // schema drift produces a silent 0-agent snapshot cached for 600s. This is
  // a library module without request-scoped logger access; raw console is
  // intentional for diagnostic visibility on a path that otherwise swallows.
  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error("agent-list rebuild: D1 query failed", result.error);
  }

  const rows = result.results ?? [];
  const cachedAgents: CachedAgent[] = rows.map(mapRowToCachedAgent);

  const genesisCount = cachedAgents.filter((a) => a.level >= 2).length;
  const messageCount = cachedAgents.reduce((sum, a) => sum + a.messageCount, 0);

  const snapshot: CachedAgentList = {
    agents: cachedAgents,
    stats: {
      total: cachedAgents.length,
      genesisCount,
      messageCount,
    },
    cachedAt: new Date().toISOString(),
  };

  // Store with TTL (awaited to ensure persistence in Workers runtime).
  // Size ceiling: CachedAgent ~500 bytes/agent. KV max value = 25MB → ~50k agent ceiling.
  // Above that, consider paginated cache shards or D1/Durable Objects.
  try {
    await kv.put(CACHE_KEY, JSON.stringify(snapshot), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {
    // Best-effort — snapshot is still returned even if write fails
  }

  return snapshot;
}
