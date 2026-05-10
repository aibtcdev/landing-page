import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import type { InboxMessage } from "@/lib/inbox/types";

/**
 * GET /api/admin/backfill-message-state — Self-documenting endpoint.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/backfill-message-state",
    description:
      "Backfill read_at and replied_at columns for existing D1 inbox_messages rows. " +
      "Iterates KV inbox:message: prefix and, for each record that has readAt and/or repliedAt set, " +
      "UPDATEs the D1 row using COALESCE (only sets if D1 currently has NULL). " +
      "Safe to run multiple times — idempotent by design.",
    method: "POST",
    headers: { "X-Admin-Key": "required" },
    parameters: {
      cursor: "string | null — resume from a previous run cursor (optional)",
      batchSize: "number — KV keys per call (default 100, max 500)",
    },
    counters: {
      scanned: "Total KV inbox:message: keys examined",
      updated_read_at: "D1 rows updated with read_at (was NULL in D1, set in KV)",
      updated_replied_at: "D1 rows updated with replied_at (was NULL in D1, set in KV)",
      skipped_already_set: "KV records where D1 already had all the non-NULL fields",
      skipped_no_timestamps: "KV records with no readAt and no repliedAt (nothing to backfill)",
      not_in_d1: "KV records with no matching D1 row (orphan-recipients, expected ~600)",
      failed: "Records that raised an error during backfill",
    },
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

interface BackfillMessageStateResult {
  cursor: string | null;
  batchSize: number;
  scanned: number;
  updated_read_at: number;
  updated_replied_at: number;
  skipped_already_set: number;
  skipped_no_timestamps: number;
  not_in_d1: number;
  failed: { key: string; reason: string }[];
  duration_ms: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseBatchSize(raw: string | null): number {
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(10, Math.min(500, n));
}

/**
 * POST /api/admin/backfill-message-state
 *
 * Cursor-paginated backfill of read_at / replied_at for existing D1 inbox_messages
 * rows. Uses COALESCE to avoid overwriting values that already exist in D1.
 *
 * Safe to run multiple times — COALESCE makes it idempotent. Loop externally
 * until the returned cursor is null.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const start = Date.now();
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const db = env.DB as D1Database | undefined;

  if (!db) {
    return NextResponse.json(
      { error: "D1 database binding (DB) is not configured" },
      { status: 503 }
    );
  }

  // Parse body
  let cursor: string | null = null;
  let batchSize = 100;
  try {
    const body = (await request.json()) as {
      cursor?: string | null;
      batchSize?: number;
    };
    cursor = body?.cursor ?? null;
    batchSize = parseBatchSize(String(body?.batchSize ?? ""));
  } catch {
    // no body / invalid JSON — use defaults
  }

  const result: BackfillMessageStateResult = {
    cursor: null,
    batchSize,
    scanned: 0,
    updated_read_at: 0,
    updated_replied_at: 0,
    skipped_already_set: 0,
    skipped_no_timestamps: 0,
    not_in_d1: 0,
    failed: [],
    duration_ms: 0,
  };

  // Scan KV inbox:message: prefix (cursor-paginated)
  const listOpts: KVNamespaceListOptions = {
    prefix: "inbox:message:",
    limit: batchSize,
  };
  if (cursor) listOpts.cursor = cursor;

  const page = await kv.list(listOpts);
  result.cursor = page.list_complete ? null : page.cursor;

  for (const kvKey of page.keys) {
    result.scanned++;

    // Read KV record
    const raw = await kv.get(kvKey.name);
    if (!raw) continue;

    let msg: InboxMessage;
    try {
      msg = JSON.parse(raw) as InboxMessage;
    } catch {
      result.failed.push({ key: kvKey.name, reason: "JSON parse error" });
      continue;
    }

    const kvReadAt = msg.readAt ?? null;
    const kvRepliedAt = msg.repliedAt ?? null;

    // Nothing to backfill if both are unset in KV
    if (!kvReadAt && !kvRepliedAt) {
      result.skipped_no_timestamps++;
      continue;
    }

    // Query D1 for the current state of these two columns
    let d1Row: { read_at: string | null; replied_at: string | null } | null = null;
    try {
      d1Row = await db
        .prepare(
          "SELECT read_at, replied_at FROM inbox_messages WHERE message_id = ?"
        )
        .bind(msg.messageId)
        .first<{ read_at: string | null; replied_at: string | null }>();
    } catch (err) {
      result.failed.push({
        key: kvKey.name,
        reason: `D1 SELECT failed: ${String(err)}`,
      });
      continue;
    }

    // No D1 row — orphan-recipient or cascade gap (not an error)
    if (!d1Row) {
      result.not_in_d1++;
      continue;
    }

    // Determine which columns actually need updating (D1 currently NULL)
    const needsReadAt = kvReadAt !== null && d1Row.read_at === null;
    const needsRepliedAt = kvRepliedAt !== null && d1Row.replied_at === null;

    if (!needsReadAt && !needsRepliedAt) {
      result.skipped_already_set++;
      continue;
    }

    // UPDATE using COALESCE — safe even if D1 somehow became non-NULL between
    // our SELECT and the UPDATE (COALESCE will leave the existing value alone).
    try {
      await db
        .prepare(
          `UPDATE inbox_messages
           SET read_at    = COALESCE(read_at, ?),
               replied_at = COALESCE(replied_at, ?)
           WHERE message_id = ?`
        )
        .bind(kvReadAt, kvRepliedAt, msg.messageId)
        .run();
    } catch (err) {
      result.failed.push({
        key: kvKey.name,
        reason: `D1 UPDATE failed: ${String(err)}`,
      });
      continue;
    }

    if (needsReadAt) result.updated_read_at++;
    if (needsRepliedAt) result.updated_replied_at++;
  }

  result.duration_ms = Date.now() - start;
  return NextResponse.json(result);
}
