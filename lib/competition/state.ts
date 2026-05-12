/**
 * D1-backed persistent state for the competition cron.
 *
 * Replaces the KV `comp:cron:cursor` key (formerly under `VERIFIED_AGENTS`)
 * with a row in the `competition_state` table from migration 009. Same
 * three-op surface (get / set / clear) so the cron only changes which
 * driver it imports.
 *
 * Why D1 instead of KV: see PR #738 review thread
 * (https://github.com/aibtcdev/landing-page/pull/738#issuecomment-4426307229).
 * Cursor state belongs in the same store as the data it gates so we can
 * audit + recover from a single source, and so future scheduler
 * primitives (Cron Trigger, DO alarm, whatever) all read the same row.
 */

const CRON_CURSOR_KEY = "cron_cursor";

export async function getCronCursor(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM competition_state WHERE key = ?1`)
    .bind(CRON_CURSOR_KEY)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setCronCursor(db: D1Database, cursor: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO competition_state (key, value, updated_at)
       VALUES (?1, ?2, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(CRON_CURSOR_KEY, cursor)
    .run();
}

export async function clearCronCursor(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM competition_state WHERE key = ?1`)
    .bind(CRON_CURSOR_KEY)
    .run();
}
