/**
 * D1 persistence for the Legion snapshot — a single-row JSON document
 * (`legion_snapshot`, migration 023). The cron is the writer; the read path
 * (lib/legion/read.ts) is the reader. D1 is the durable source of truth;
 * caches.default is the hot layer on top, exactly like the leaderboard.
 */

import type { LegionSnapshot } from "./types";

/** The snapshot lives in a single row, pinned to id = 1 by a CHECK constraint. */
const SNAPSHOT_ID = 1;

export async function readLegionSnapshotFromD1(
  db: D1Database,
): Promise<LegionSnapshot | null> {
  const row = await db
    .prepare("SELECT snapshot_json FROM legion_snapshot WHERE id = ?1")
    .bind(SNAPSHOT_ID)
    .first<{ snapshot_json: string }>();
  if (!row?.snapshot_json) return null;
  try {
    return JSON.parse(row.snapshot_json) as LegionSnapshot;
  } catch {
    return null;
  }
}

export async function writeLegionSnapshotToD1(
  db: D1Database,
  snapshot: LegionSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO legion_snapshot (id, snapshot_json, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(id) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at`,
    )
    .bind(SNAPSHOT_ID, JSON.stringify(snapshot), snapshot.updatedAt)
    .run();
}
