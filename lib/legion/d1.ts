/**
 * D1 persistence for Legion snapshots — one JSON document per Legion in
 * `legion_snapshots` (migration 024), keyed by `legion_id`. The cron is the
 * writer; the read path (lib/legion/read.ts) is the reader. D1 is the durable
 * source of truth; caches.default is the hot layer on top, like the leaderboard.
 *
 * Keys: the registry's numeric id as text ("1", …), the slug "demand" for the
 * known demand Legion, or REGISTRY_ROW_ID ("__registry__") for the index that
 * backs the `/legions` list page.
 */

import type {
  LegionSnapshot,
  ProviderSnapshot,
  RegistrySnapshot,
} from "./types";

/** Reserved legion_id for the `/legions` registry-index snapshot. */
export const REGISTRY_ROW_ID = "__registry__";

async function readRow<T>(db: D1Database, legionId: string): Promise<T | null> {
  const row = await db
    .prepare("SELECT snapshot_json FROM legion_snapshots WHERE legion_id = ?1")
    .bind(legionId)
    .first<{ snapshot_json: string }>();
  if (!row?.snapshot_json) return null;
  try {
    return JSON.parse(row.snapshot_json) as T;
  } catch {
    return null;
  }
}

async function writeRow(
  db: D1Database,
  legionId: string,
  json: unknown,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO legion_snapshots (legion_id, snapshot_json, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(legion_id) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at`,
    )
    .bind(legionId, JSON.stringify(json), updatedAt)
    .run();
}

// ── Demand Legion snapshot ─────────────────────────────────────────────────

export function readLegionSnapshotFromD1(
  db: D1Database,
  legionId: string,
): Promise<LegionSnapshot | null> {
  return readRow<LegionSnapshot>(db, legionId);
}

export function writeLegionSnapshotToD1(
  db: D1Database,
  legionId: string,
  snapshot: LegionSnapshot,
): Promise<void> {
  return writeRow(db, legionId, snapshot, snapshot.updatedAt);
}

// ── Provider Legion snapshot ───────────────────────────────────────────────

export function readProviderSnapshotFromD1(
  db: D1Database,
  legionId: string,
): Promise<ProviderSnapshot | null> {
  return readRow<ProviderSnapshot>(db, legionId);
}

export function writeProviderSnapshotToD1(
  db: D1Database,
  legionId: string,
  snapshot: ProviderSnapshot,
): Promise<void> {
  return writeRow(db, legionId, snapshot, snapshot.updatedAt);
}

// ── Registry index snapshot (backs /legions) ───────────────────────────────

export function readRegistrySnapshotFromD1(
  db: D1Database,
): Promise<RegistrySnapshot | null> {
  return readRow<RegistrySnapshot>(db, REGISTRY_ROW_ID);
}

export function writeRegistrySnapshotToD1(
  db: D1Database,
  snapshot: RegistrySnapshot,
): Promise<void> {
  return writeRow(db, REGISTRY_ROW_ID, snapshot, snapshot.updatedAt);
}
