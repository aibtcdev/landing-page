/**
 * GET /api/admin/schema-health
 *
 * Runs EXPLAIN QUERY PLAN on critical hot queries and flags any result whose
 * plan contains a full table SCAN without using an index. Cross-references
 * sqlite_master for a live index inventory so silently dropped indexes are
 * visible immediately.
 *
 * Motivation: migration 008 (nullable_btc_public_key) silently dropped the
 * inbox_messages, claims, vouches, swaps, and balances indexes via the SQLite
 * table-rebuild dance. Every inbox listing became a full table scan and caused
 * ~96% of all D1 rows-read (~4.5B/day, ~$100+/mo overage). The indexes existed
 * in migration *files* but not in the live database — trusted the files, never
 * ran EXPLAIN / checked sqlite_master until the cost exploded. This endpoint
 * catches exactly that class of regression before it becomes a billing event.
 *
 * Auth: X-Admin-Key header (same as all admin routes).
 * Cost: EXPLAIN QUERY PLAN is plan-only and free — it never scans rows.
 *
 * See: migrations/019_restore_dropped_indexes.sql (the fix for migration 008)
 * See: ~/dev/aibtcdev/cloudflare-bill-audit-2026-04.md (incident details)
 * See: ~/dev/whoabuddy/claude-knowledge/patterns/d1-schema-health.md (recipe)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { LEADERBOARD_AGGREGATE_SQL } from "@/lib/competition/leaderboard-query";
import { isScanWithoutIndex } from "./scan-detection";

// ---------------------------------------------------------------------------
// Query definitions
// ---------------------------------------------------------------------------

interface QueryDef {
  name: string;
  sql: string;
  params: (string | number)[];
}

/**
 * Critical hot queries to EXPLAIN. These are the production queries most
 * likely to cause runaway D1 row-read costs if an index is dropped.
 *
 * Use representative bound parameters (not real addresses) so the query
 * planner exercises the same code path as production.
 */
const HOT_QUERIES: QueryDef[] = [
  {
    name: "inbox_list",
    sql: `
      SELECT
        message_id, from_stx_address, to_btc_address, to_stx_address,
        content, payment_txid, payment_satoshis, payment_status,
        payment_id, receipt_id, recovered_via_txid, authenticated,
        bitcoin_signature, sender_btc_address,
        sent_at, read_at, replied_at, reply_to_message_id
      FROM inbox_messages
      WHERE to_btc_address = ? AND is_reply = 0
      ORDER BY sent_at DESC LIMIT ? OFFSET ?
    `.trim(),
    params: ["bc1placeholder", 20, 0],
  },
  {
    name: "inbox_unread_stats",
    sql: `
      SELECT received_count, unread_count, sent_count, last_message_at, last_sent_at
      FROM agent_inbox_stats
      WHERE btc_address = ?
    `.trim(),
    params: ["bc1placeholder"],
  },
  {
    name: "leaderboard_aggregate",
    sql: LEADERBOARD_AGGREGATE_SQL.trim(),
    params: [],
  },
  {
    name: "bounty_list",
    sql: `
      SELECT
        id, poster_btc_address, poster_stx_address, title, description,
        reward_sats, submission_count, created_at, expires_at,
        accepted_submission_id, accepted_at, paid_txid, paid_at,
        cancelled_at, updated_at, tags
      FROM bounties
      WHERE cancelled_at IS NULL AND paid_at IS NULL
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `.trim(),
    params: [20, 0],
  },
  {
    name: "agents_list",
    sql: `
      SELECT
        stx_address, btc_address, display_name, bns_name, description,
        owner, taproot_address, nostr_public_key, last_active_at,
        last_check_in_at, verified_at, erc8004_agent_id, referred_by_btc
      FROM agents
      ORDER BY verified_at DESC LIMIT ? OFFSET ?
    `.trim(),
    params: [20, 0],
  },
];

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface QueryResult {
  name: string;
  sql: string;
  plan: string[];
  usesIndex: boolean;
  flagged: boolean;
  error?: string;
}

interface IndexRecord {
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface SchemaHealthResponse {
  healthy: boolean;
  checkedAt: string;
  queries: QueryResult[];
  indexes: IndexRecord[];
  flaggedCount: number;
}

// ---------------------------------------------------------------------------
// EXPLAIN QUERY PLAN row shape
// ---------------------------------------------------------------------------

interface ExplainRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/schema-health
 *
 * Runs EXPLAIN QUERY PLAN on each critical hot query and cross-references
 * sqlite_master for the live index inventory. Returns a structured JSON
 * report with per-query plan details and an overall healthy boolean.
 *
 * A result is flagged when the EXPLAIN plan contains a "SCAN tablename"
 * line without any "USING INDEX" clause — meaning the query planner found
 * no usable index and will scan every row in the table.
 *
 * If healthy === false, at least one query is doing a full table scan.
 * This is exactly the condition migration 019 fixed; if it ever regresses,
 * this endpoint will flag it on the next run.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let db: D1Database | undefined;
  try {
    const { env } = await getCloudflareContext();
    db = env.DB as D1Database | undefined;
  } catch (e) {
    console.error("schema-health: failed to get Cloudflare context", e);
    return NextResponse.json(
      { error: "Failed to get runtime context" },
      { status: 500 }
    );
  }

  if (!db) {
    return NextResponse.json(
      { error: "D1 binding (DB) not available" },
      { status: 503 }
    );
  }

  const checkedAt = new Date().toISOString();

  // Run EXPLAIN QUERY PLAN on each critical query
  const queryResults: QueryResult[] = await Promise.all(
    HOT_QUERIES.map(async (q): Promise<QueryResult> => {
      try {
        const explainSql = `EXPLAIN QUERY PLAN ${q.sql}`;
        const result = await db!
          .prepare(explainSql)
          .bind(...q.params)
          .all<ExplainRow>();

        const planRows = result.results ?? [];
        const planDetails = planRows.map((row) => row.detail ?? "");

        // Flag if any plan line is a SCAN without an index
        const hasBadScan = planDetails.some(isScanWithoutIndex);

        return {
          name: q.name,
          sql: q.sql,
          plan: planDetails,
          usesIndex: !hasBadScan,
          flagged: hasBadScan,
        };
      } catch (e) {
        // EXPLAIN itself failed (e.g. table doesn't exist yet, syntax error).
        // Treat as flagged so missing tables are visible.
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`schema-health: EXPLAIN failed for ${q.name}:`, errMsg);
        return {
          name: q.name,
          sql: q.sql,
          plan: [],
          usesIndex: false,
          flagged: true,
          error: errMsg,
        };
      }
    })
  );

  // Fetch live index inventory from sqlite_master
  let indexes: IndexRecord[] = [];
  try {
    const indexResult = await db
      .prepare(
        `SELECT name, tbl_name, sql
         FROM sqlite_master
         WHERE type = 'index'
         ORDER BY tbl_name, name`
      )
      .all<IndexRecord>();
    indexes = indexResult.results ?? [];
  } catch (e) {
    console.error("schema-health: sqlite_master query failed", e);
    // Non-fatal: continue with empty index list
  }

  const flaggedCount = queryResults.filter((q) => q.flagged).length;
  const healthy = flaggedCount === 0;

  const body: SchemaHealthResponse = {
    healthy,
    checkedAt,
    queries: queryResults,
    indexes,
    flaggedCount,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 200 });
}
