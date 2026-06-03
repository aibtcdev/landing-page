/**
 * GET /api/admin/schema-health
 *
 * Runs EXPLAIN QUERY PLAN on critical hot queries and flags any result whose
 * plan does not reference its expected index(es). Cross-references
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
 * See: migrations/014_bounties.sql (idx_bounties_active_created)
 * See: migrations/001_agents.sql (idx_agents_verified_at)
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
  /**
   * The specific SQLite index name(s) this query MUST use in production.
   * A query is flagged unhealthy if EITHER:
   *   (a) none of these names appears in the EXPLAIN plan, OR
   *   (b) any of these names (excluding sqlite_autoindex_* entries) is absent
   *       from the sqlite_master index inventory.
   *
   * For PRIMARY KEY lookups, SQLite generates an autoindex whose name follows
   * the pattern `sqlite_autoindex_<table>_1`. List it to assert plan usage, but
   * note: autoindexes do NOT appear in sqlite_master (they are schema-level
   * constraints, not CREATE INDEX rows), so the master check is skipped for them.
   */
  expectedIndexes: string[];
}

/**
 * Critical hot queries to EXPLAIN. These are the production queries most
 * likely to cause runaway D1 row-read costs if an index is dropped.
 *
 * Use representative bound parameters (not real addresses) so the query
 * planner exercises the same code path as production.
 *
 * Index name sources:
 *   inbox_list            → migrations/019_restore_dropped_indexes.sql (line 33)
 *   inbox_unread_stats    → migrations/012_agent_inbox_stats.sql (btc_address TEXT PRIMARY KEY)
 *   leaderboard_aggregate → migrations/010_swaps_token_indexes.sql + 005_swaps.sql
 *   bounty_list           → migrations/014_bounties.sql (line 51)
 *   agents_list           → migrations/001_agents.sql (line 39)
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
    // Partial covering index on (to_btc_address, sent_at DESC) WHERE is_reply = 0
    // Defined in migrations/003_inbox_messages.sql, restored by migrations/019
    expectedIndexes: ["idx_inbox_to_btc_sent_at"],
  },
  {
    name: "inbox_unread_stats",
    sql: `
      SELECT received_count, unread_count, sent_count, last_message_at, last_sent_at
      FROM agent_inbox_stats
      WHERE btc_address = ?
    `.trim(),
    params: ["bc1placeholder"],
    // agent_inbox_stats has btc_address TEXT PRIMARY KEY → SQLite autoindex
    // Defined in migrations/012_agent_inbox_stats.sql
    expectedIndexes: ["sqlite_autoindex_agent_inbox_stats_1"],
  },
  {
    name: "leaderboard_aggregate",
    sql: LEADERBOARD_AGGREGATE_SQL.trim(),
    params: [],
    // Covers swaps access patterns: either composite token index (010)
    // or the sender/time index (005) may be chosen by the planner.
    // Also accepts the agents verified_at index for the JOIN side.
    // Any of these in the plan confirms index use; their presence in
    // sqlite_master is checked belt-and-suspenders.
    expectedIndexes: [
      "idx_swaps_token_in_active",
      "idx_swaps_sender_burn_time",
      "idx_agents_verified_at",
    ],
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
    // Partial index on (created_at DESC) WHERE cancelled_at IS NULL AND paid_at IS NULL
    // Defined in migrations/014_bounties.sql (line 51)
    expectedIndexes: ["idx_bounties_active_created"],
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
    // Defined in migrations/001_agents.sql (line 39), re-created by migration 008
    expectedIndexes: ["idx_agents_verified_at"],
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
  /** Which expected index name was not found (in plan or sqlite_master). */
  missingIndex?: string;
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
 * A result is flagged when EITHER:
 *   (a) the EXPLAIN plan does not reference any of the query's expected
 *       indexes — this catches both pure-SCAN regressions AND cases where
 *       the planner falls back to a different index after the intended one
 *       is dropped (e.g. DROP INDEX idx_bounties_active_created → planner
 *       falls back to idx_bounties_created, which still passes isScanWithoutIndex
 *       but misses the partial-index optimization), OR
 *   (b) any of the expected indexes is absent from sqlite_master — this
 *       catches a drop even before EXPLAIN reflects it.
 *
 * Returns HTTP 200 when healthy, 503 when at least one query is flagged,
 * so external uptime monitors can alert on schema regressions.
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

  // Fetch live index inventory from sqlite_master first — used for belt-and-
  // suspenders check against expectedIndexes for each query.
  let indexes: IndexRecord[] = [];
  const liveIndexNames = new Set<string>();
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
    for (const idx of indexes) {
      liveIndexNames.add(idx.name);
    }
  } catch (e) {
    console.error("schema-health: sqlite_master query failed", e);
    // Non-fatal: continue with empty index set (all expectedIndexes will flag)
  }

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
        const planText = planDetails.join("\n");

        // Belt-and-suspenders check:
        // (a) Does the EXPLAIN plan reference any expected index?
        const planUsesExpectedIndex = q.expectedIndexes.some((idx) =>
          planText.includes(idx)
        );

        // (b) Are all explicit (non-auto) expected indexes present in sqlite_master?
        //     SQLite autoindexes (sqlite_autoindex_*) are implicitly created for
        //     PRIMARY KEY / UNIQUE constraints and do NOT appear in sqlite_master —
        //     they only show up in EXPLAIN plans. Skip the master check for those;
        //     the plan check above already covers their presence. For explicit
        //     CREATE INDEX entries, absence from sqlite_master means the index was
        //     silently dropped (the migration-008 failure mode).
        const missingFromMaster = q.expectedIndexes.find(
          (idx) =>
            !idx.startsWith("sqlite_autoindex_") && !liveIndexNames.has(idx)
        );

        // Also flag a bare SCAN for belt-and-suspenders visibility even if
        // expectedIndexes were not listed — pure helper coverage
        const hasBadScan = planDetails.some(isScanWithoutIndex);

        // Flagged if: plan doesn't use an expected index OR expected index is missing
        const flagged =
          !planUsesExpectedIndex ||
          missingFromMaster !== undefined ||
          hasBadScan;

        const missingIndex = !planUsesExpectedIndex
          ? q.expectedIndexes[0]
          : missingFromMaster;

        return {
          name: q.name,
          sql: q.sql,
          plan: planDetails,
          usesIndex: !hasBadScan,
          flagged,
          ...(flagged && missingIndex !== undefined
            ? { missingIndex }
            : undefined),
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
          missingIndex: q.expectedIndexes[0],
          error: errMsg,
        };
      }
    })
  );

  const flaggedCount = queryResults.filter((q) => q.flagged).length;
  const healthy = flaggedCount === 0;

  const body: SchemaHealthResponse = {
    healthy,
    checkedAt,
    queries: queryResults,
    indexes,
    flaggedCount,
  };

  // Return 503 when unhealthy so external uptime monitors can alert on regressions.
  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
