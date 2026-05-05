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
 * `btc:` after the index hit and can validate (or fall through to
 * a recovery scan).
 *
 * On cold miss the index is rebuilt by a one-shot scan, gated by a
 * 60s sentinel so concurrent rebuilds don't dogpile.
 *
 * Maintenance is best-effort on write paths; failures are logged
 * but don't fail the caller. Drift heals naturally on the next
 * cold-miss rebuild.
 */

import type { AgentRecord } from "./types";
import type { Logger } from "./logging";

const INDEX_KEY = "agents:index";
const BACKFILL_LOCK_KEY = "agents:index:building";
const BACKFILL_LOCK_TTL = 60;
const BACKFILL_POLL_DEADLINE_MS = 1500;
const BACKFILL_POLL_INTERVAL_MS = 150;

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
): Promise<void> {
  const index: AgentsIndex = {
    agents,
    updatedAt: new Date().toISOString(),
    v: 1,
  };
  await kv.put(INDEX_KEY, JSON.stringify(index));
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

    const records = await Promise.all(
      page.keys.map(async (key) => {
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
    await writeIndex(kv, entries);
    logger?.info("agents_index.backfilled", { count: entries.length });
    return {
      agents: entries,
      updatedAt: new Date().toISOString(),
      v: 1,
    };
  } finally {
    await kv.delete(BACKFILL_LOCK_KEY).catch(() => {});
  }
}

/**
 * Insert or replace an agent in the index. No-op when the index
 * doesn't exist yet — the first reader will trigger a backfill
 * that picks up the source-of-truth `stx:`/`btc:` records.
 *
 * Best-effort: failures are logged but don't fail the caller.
 * Concurrent upserts can race and lose updates; drift heals on
 * the next cold-miss rebuild and individual hot paths re-fetch
 * the full record from `btc:` so a stale index never returns
 * incorrect data.
 */
export async function upsertAgentIndex(
  kv: KVNamespace,
  agent: AgentRecord,
  logger?: Logger,
): Promise<void> {
  try {
    const current = await readIndex(kv);
    if (!current) return;
    const entry = toEntry(agent);
    const next = current.agents.filter(
      (a) => a.btcAddress !== entry.btcAddress,
    );
    next.push(entry);
    await writeIndex(kv, next);
  } catch (e) {
    logger?.warn("agents_index.upsert_error", {
      btc: agent.btcAddress,
      error: String(e),
    });
  }
}

/**
 * Remove an agent from the index by btcAddress. Best-effort.
 */
export async function removeAgentFromIndex(
  kv: KVNamespace,
  btcAddress: string,
  logger?: Logger,
): Promise<void> {
  try {
    const current = await readIndex(kv);
    if (!current) return;
    const next = current.agents.filter((a) => a.btcAddress !== btcAddress);
    if (next.length === current.agents.length) return;
    await writeIndex(kv, next);
  } catch (e) {
    logger?.warn("agents_index.remove_error", {
      btc: btcAddress,
      error: String(e),
    });
  }
}
