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
 * D1 row shape for the agents SELECT used in buildIndexFromD1.
 * Only the columns needed for AgentIndexEntry are selected.
 */
interface AgentIndexRow {
  btc_address: string;
  stx_address: string;
  taproot_address: string | null;
  bns_name: string | null;
  display_name: string | null;
  capabilities_json: string | null;
  verified_at: string;
}

/**
 * Rebuild the index from D1 via a single SELECT. Returns all rows
 * as AgentIndexEntry[].
 *
 * Returns null if the D1 query fails (caller falls back to KV scan).
 * Logs a warning if fewer than MIN_EXPECTED_D1_ROWS rows are returned
 * as a signal that D1 may not yet be fully backfilled (see #691).
 */
const MIN_EXPECTED_D1_ROWS = 100;

async function buildIndexFromD1(
  db: D1Database,
  logger?: Logger,
): Promise<AgentIndexEntry[] | null> {
  try {
    const result = await db
      .prepare(
        `SELECT btc_address, stx_address, taproot_address, bns_name,
                display_name, capabilities_json, verified_at
         FROM agents
         ORDER BY verified_at ASC`,
      )
      .all<AgentIndexRow>();

    const entries: AgentIndexEntry[] = result.results.map((row) => ({
      btcAddress: row.btc_address,
      stxAddress: row.stx_address,
      taprootAddress: row.taproot_address ?? null,
      bnsName: row.bns_name ?? null,
      displayName: row.display_name ?? null,
      capabilities: row.capabilities_json
        ? (() => {
            try {
              return JSON.parse(row.capabilities_json!) as string[];
            } catch {
              return null;
            }
          })()
        : null,
      verifiedAt: row.verified_at,
    }));

    if (entries.length < MIN_EXPECTED_D1_ROWS) {
      // D1 backfill (#691) may be incomplete. Treat as "not ready" and
      // return null so the caller falls back to the KV-scan safety net.
      // A partial index must never be cached — callers would serve stale
      // incomplete results until the next cold-miss rebuild.
      logger?.warn("agents_index.d1_low_row_count", {
        count: entries.length,
        threshold: MIN_EXPECTED_D1_ROWS,
        note: "D1 backfill (#691) may be in progress — falling back to KV scan",
      });
      return null;
    }

    return entries;
  } catch (e) {
    logger?.warn("agents_index.d1_query_error", { error: String(e) });
    return null;
  }
}

/**
 * Rebuild the index by scanning all `stx:` keys. Fallback path used
 * when D1 is unavailable or returns an unexpected result. This is the
 * same work hot paths used to do on every request before B6 — kept as
 * a safety net while D1 backfill (#691) is in progress.
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
 * Get the agents index. On cold miss, rebuilds from D1 (single SELECT)
 * when a D1Database is provided, falling back to the KV scan if D1 is
 * unavailable or returns null. Concurrent rebuilds are gated with a
 * 60s sentinel; loser requests poll briefly before falling through.
 *
 * @param kv - KV namespace for index storage and fallback scan.
 * @param db - Optional D1 binding (env.DB). When provided, cold-miss
 *   rebuilds use a single D1 SELECT instead of kv.list + N kv.get.
 * @param logger - Optional structured logger.
 */
export async function getAgentsIndex(
  kv: KVNamespace,
  db?: D1Database,
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
    // Prefer D1 SELECT (single query, ~5 ms) over KV scan (~431 reads).
    // Falls back to KV scan if db is absent or the query fails — ensures
    // the index is always populated even if D1 backfill (#691) is
    // incomplete.
    let entries: AgentIndexEntry[] | null = null;
    if (db) {
      entries = await buildIndexFromD1(db, logger);
      if (entries !== null) {
        logger?.info("agents_index.backfilled_from_d1", {
          count: entries.length,
        });
      }
    }
    if (entries === null) {
      logger?.warn("agents_index.falling_back_to_kv_scan", {
        reason: db ? "d1_query_failed" : "no_d1_binding",
      });
      entries = await buildIndexFromScan(kv, logger);
      logger?.info("agents_index.backfilled_from_kv", {
        count: entries.length,
      });
    }

    const index = await writeIndex(kv, entries);
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
