/**
 * Slim, maintained KV index of all registered agents.
 *
 * Replaces O(N) `kv.list({prefix:"stx:"})` + N `kv.get()` scans on
 * hot paths (BNS lookup, capability discovery, agent-list rebuild)
 * with a single `kv.get("agents:index")` read.
 *
 * **Source of truth:** `stx:` and `btc:` AgentRecord entries.
 * **This index is a soft cache.** Stale entries are tolerable
 * because every hot-path consumer fetches the full record by
 * `btc:` after the index hit and validates the relevant field
 * (e.g. bnsName) against the source record. On a mismatch the
 * consumer returns null — drift surfaces as a 404 rather than
 * incorrect data, and converges on the next cold-miss rebuild.
 *
 * On cold miss the index is rebuilt by a one-shot scan. A 60s
 * sentinel `agents:index:building` is a *best-effort* dogpile
 * mitigation: KV is eventually consistent across colos, so a
 * sentinel write may not be visible to other rebuilders for some
 * milliseconds-to-seconds and a duplicate rebuild can still
 * happen. The duplicate is wasteful but not incorrect — both
 * writers compute the same source state and the last write wins.
 *
 * Write maintenance uses {@link invalidateAgentsIndex}
 * (delete-and-let-next-reader-rebuild). This avoids the
 * read-modify-write race that an in-place upsert would have under
 * concurrent registrations: KV has no native CAS, and a stale
 * read on one writer would silently overwrite another writer's
 * update, permanently dropping an entry from the index until
 * manual intervention.
 */

import type { AgentRecord } from "./types";
import type { Logger } from "./logging";

const INDEX_KEY = "agents:index";
const BACKFILL_LOCK_KEY = "agents:index:building";
const BACKFILL_LOCK_TTL = 60;
const BACKFILL_POLL_DEADLINE_MS = 1500;
const BACKFILL_POLL_INTERVAL_MS = 150;
/**
 * Bounds peak concurrent KV reads + JSON parses during the cold-
 * miss scan. KV's `kv.list` page cap (1000 keys) is a natural
 * upper bound; this reduces to a tighter, predictable fan-out as
 * the registry grows.
 */
const BACKFILL_FETCH_BATCH_SIZE = 500;

/**
 * Slim per-agent index entry. Holds only the fields hot-path scan
 * endpoints need to identify, filter, or route to an agent — full
 * AgentRecord fetches still happen via `kv.get("btc:...")` once an
 * entry is selected.
 *
 * Size at 430 agents ≈ 130 KB (well under KV's 25 MB value cap).
 * Sharded migration path is documented below for >80K agents.
 */
export interface AgentIndexEntry {
  btcAddress: string;
  stxAddress: string;
  taprootAddress: string | null;
  bnsName: string | null;
  displayName: string | null;
  capabilities: string[] | null;
  verifiedAt: string;
}

export interface AgentsIndex {
  agents: AgentIndexEntry[];
  updatedAt: string;
  /** Schema version. Bump when AgentIndexEntry shape changes. */
  v: 1;
}

function toEntry(agent: AgentRecord): AgentIndexEntry {
  return {
    btcAddress: agent.btcAddress,
    stxAddress: agent.stxAddress,
    taprootAddress: agent.taprootAddress ?? null,
    bnsName: agent.bnsName ?? null,
    displayName: agent.displayName ?? null,
    capabilities: agent.capabilities ?? null,
    verifiedAt: agent.verifiedAt,
  };
}

async function readIndex(kv: KVNamespace): Promise<AgentsIndex | null> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AgentsIndex;
    if (parsed?.v === 1 && Array.isArray(parsed.agents)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function writeIndex(
  kv: KVNamespace,
  agents: AgentIndexEntry[],
): Promise<AgentsIndex> {
  const index: AgentsIndex = {
    agents,
    updatedAt: new Date().toISOString(),
    v: 1,
  };
  await kv.put(INDEX_KEY, JSON.stringify(index));
  return index;
}

/**
 * Rebuild the index by scanning all `stx:` keys. One-shot recovery
 * path used on cold miss; this is the SAME work the hot paths used
 * to do every request, so we want it to fire at most once per
 * deployment / index-loss event.
 */
async function buildIndexFromScan(
  kv: KVNamespace,
  logger?: Logger,
): Promise<AgentIndexEntry[]> {
  const entries: AgentIndexEntry[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const page = await kv.list({ prefix: "stx:", cursor });
    listComplete = page.list_complete;
    cursor = !page.list_complete ? page.cursor : undefined;

    // Chunk the page-key fetches to bound peak concurrency,
    // matching the rebuild path's BACKFILL_FETCH_BATCH_SIZE.
    for (let i = 0; i < page.keys.length; i += BACKFILL_FETCH_BATCH_SIZE) {
      const batch = page.keys.slice(i, i + BACKFILL_FETCH_BATCH_SIZE);
      const records = await Promise.all(
        batch.map(async (key) => {
          try {
            const raw = await kv.get(key.name);
            if (!raw) return null;
            return JSON.parse(raw) as AgentRecord;
          } catch (e) {
            logger?.warn("agents_index.scan_parse_error", {
              key: key.name,
              error: String(e),
            });
            return null;
          }
        }),
      );
      for (const record of records) {
        if (record) entries.push(toEntry(record));
      }
    }
  }

  return entries;
}

/**
 * Get the agents index. On cold miss, performs a one-shot scan-
 * based backfill, gating concurrent rebuilds with a 60s sentinel.
 * Loser requests poll briefly for the winner's result before
 * falling through to their own scan (so a stuck sentinel never
 * blocks the read).
 */
export async function getAgentsIndex(
  kv: KVNamespace,
  logger?: Logger,
): Promise<AgentsIndex> {
  const cached = await readIndex(kv);
  if (cached) return cached;

  logger?.warn("agents_index.cold_miss");

  if (await kv.get(BACKFILL_LOCK_KEY)) {
    const deadline = Date.now() + BACKFILL_POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((r) =>
        setTimeout(r, BACKFILL_POLL_INTERVAL_MS),
      );
      const snapshot = await readIndex(kv);
      if (snapshot) return snapshot;
    }
  }

  try {
    await kv.put(BACKFILL_LOCK_KEY, "1", {
      expirationTtl: BACKFILL_LOCK_TTL,
    });
  } catch {
    // Best-effort: a duplicate rebuild is wasteful but not wrong.
  }

  try {
    const entries = await buildIndexFromScan(kv, logger);
    const index = await writeIndex(kv, entries);
    logger?.info("agents_index.backfilled", { count: entries.length });
    return index;
  } finally {
    await kv.delete(BACKFILL_LOCK_KEY).catch(() => {});
  }
}

/**
 * Invalidate the agents:index. The next reader rebuilds it from
 * source `stx:*` records via {@link getAgentsIndex} — gated by the
 * existing 60s sentinel so concurrent rebuilds don't dogpile.
 *
 * Maintenance hook for every write path that mutates an indexed
 * field (`bnsName`, `displayName`, `taprootAddress`, `capabilities`).
 * Invalidate-on-write avoids the read-modify-write race that an
 * in-place upsert would have under concurrent registrations or
 * profile updates: KV has no native CAS, and a stale read on one
 * writer would silently overwrite another writer's update,
 * permanently dropping an entry until manual intervention.
 *
 * Cost trade-off: each invalidation triggers one full rebuild on
 * the next index read (1 list + N stx-gets, ≈ 431 reads at current
 * scale). At our write rate (~tens per day) this adds <1% of the
 * read savings B6 banks; in exchange the index always converges to
 * source state.
 */
export async function invalidateAgentsIndex(
  kv: KVNamespace,
  logger?: Logger,
): Promise<void> {
  try {
    await kv.delete(INDEX_KEY);
  } catch (e) {
    logger?.warn("agents_index.invalidate_error", {
      error: String(e),
    });
  }
}
