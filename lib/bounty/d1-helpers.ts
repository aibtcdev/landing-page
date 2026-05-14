/**
 * D1 helpers for the bounty system.
 *
 * D1 is the sole source of truth (post-Phase 2.5 / PR #745). There is no KV
 * mirror of bounty records. Hot reads get an edge cache; reverse indexes are
 * SQL queries with proper indexes (see `migrations/012_bounties.sql`).
 *
 * Status is derived, not stored. The list helper accepts a `BountyStatus`
 * filter and compiles it to the matching SQL predicate via `statusToSql`.
 */

import type { BountyRecord, BountyStatus, BountySubmission } from "./types";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "./constants";

// ---------------------------------------------------------------------------
// Row shapes (snake_case as returned by D1) + mappers
// ---------------------------------------------------------------------------

interface D1BountyRow {
  id: string;
  poster_btc_address: string;
  poster_stx_address: string;
  title: string;
  description: string;
  reward_sats: number;
  submission_count: number;
  created_at: string;
  expires_at: string;
  accepted_submission_id: string | null;
  accepted_at: string | null;
  paid_txid: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
  tags: string | null;
}

interface D1SubmissionRow {
  id: string;
  bounty_id: string;
  submitter_btc_address: string;
  submitter_stx_address: string;
  content_url: string | null;
  message: string;
  created_at: string;
}

function rowToBounty(row: D1BountyRow): BountyRecord {
  return {
    id: row.id,
    posterBtcAddress: row.poster_btc_address,
    posterStxAddress: row.poster_stx_address,
    title: row.title,
    description: row.description,
    rewardSats: row.reward_sats,
    submissionCount: row.submission_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.accepted_submission_id != null && {
      acceptedSubmissionId: row.accepted_submission_id,
    }),
    ...(row.accepted_at != null && { acceptedAt: row.accepted_at }),
    ...(row.paid_txid != null && { paidTxid: row.paid_txid }),
    ...(row.paid_at != null && { paidAt: row.paid_at }),
    ...(row.cancelled_at != null && { cancelledAt: row.cancelled_at }),
    updatedAt: row.updated_at,
    ...(row.tags != null && safeParseTags(row.tags)),
  };
}

function safeParseTags(value: string): { tags?: string[] } {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
      return { tags: parsed };
    }
  } catch {
    /* fall through */
  }
  return {};
}

function rowToSubmission(row: D1SubmissionRow): BountySubmission {
  return {
    id: row.id,
    bountyId: row.bounty_id,
    submitterBtcAddress: row.submitter_btc_address,
    submitterStxAddress: row.submitter_stx_address,
    ...(row.content_url != null && { contentUrl: row.content_url }),
    message: row.message,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Status → SQL predicate
// ---------------------------------------------------------------------------

/**
 * Compile a BountyStatus filter to a SQL WHERE-fragment + positional bindings.
 *
 * The math relies on ISO-8601 timestamps sorting lexicographically — which
 * they do, because they're zero-padded and fixed-width. Comparisons like
 * `expires_at + 14d > now` rewrite to `expires_at > (now - 14d)` so we never
 * have to do arithmetic on TEXT columns in SQL.
 *
 * Pass `undefined` for "no status filter" (omit the fragment). Pass `"active"`
 * for the default list view (all non-terminal states).
 */
export function statusToSql(
  status: BountyStatus | "active" | undefined,
  now: Date = new Date()
): { sql: string; bindings: string[] } {
  const nowIso = now.toISOString();
  const acceptCutoffIso = new Date(now.getTime() - ACCEPT_GRACE_MS).toISOString();
  const payCutoffIso = new Date(now.getTime() - PAY_GRACE_MS).toISOString();

  switch (status) {
    case "open":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND expires_at > ?",
        bindings: [nowIso],
      };
    case "judging":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND expires_at <= ? AND expires_at > ?",
        bindings: [nowIso, acceptCutoffIso],
      };
    case "winner-announced":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NOT NULL AND accepted_at > ?",
        bindings: [payCutoffIso],
      };
    case "paid":
      return { sql: "paid_at IS NOT NULL", bindings: [] };
    case "abandoned":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND ((accepted_at IS NULL AND expires_at < ?) OR (accepted_at IS NOT NULL AND accepted_at < ?))",
        bindings: [acceptCutoffIso, payCutoffIso],
      };
    case "cancelled":
      return { sql: "cancelled_at IS NOT NULL", bindings: [] };
    case "active":
      return { sql: "cancelled_at IS NULL AND paid_at IS NULL", bindings: [] };
    case undefined:
      return { sql: "1=1", bindings: [] };
  }
}

// ---------------------------------------------------------------------------
// Bounty reads
// ---------------------------------------------------------------------------

const BOUNTY_COLUMNS = `
  id, poster_btc_address, poster_stx_address, title, description,
  reward_sats, submission_count, created_at, expires_at,
  accepted_submission_id, accepted_at, paid_txid, paid_at,
  cancelled_at, updated_at, tags
`;

/** Fetch one bounty by id. Returns null if not found. */
export async function getBounty(db: D1Database, id: string): Promise<BountyRecord | null> {
  const row = await db
    .prepare(`SELECT ${BOUNTY_COLUMNS} FROM bounties WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<D1BountyRow>();
  return row ? rowToBounty(row) : null;
}

export interface ListBountiesFilters {
  status?: BountyStatus | "active";
  posterBtcAddress?: string;
  /** Filter to bounties this agent has submitted to (via JOIN). */
  submitterBtcAddress?: string;
  /** JSON-array tag filter — exact match on any tag in the JSON array. */
  tag?: string;
  limit?: number;
  offset?: number;
  /** Override "now" — used by tests for deterministic status filtering. */
  now?: Date;
}

export interface ListBountiesResult {
  bounties: BountyRecord[];
  total: number;
}

/**
 * List bounties with optional status + poster + submitter + tag filters.
 *
 * When `submitterBtcAddress` is set, joins `bounty_submissions` to find
 * bounties this agent has submitted to (one row per bounty, distinct).
 * Status filter is applied via `statusToSql()`.
 */
export async function listBounties(
  db: D1Database,
  filters: ListBountiesFilters = {}
): Promise<ListBountiesResult> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const now = filters.now ?? new Date();

  const statusFrag = statusToSql(filters.status ?? "active", now);
  const conditions: string[] = [statusFrag.sql];
  const bindings: (string | number)[] = [...statusFrag.bindings];

  let joinClause = "";
  if (filters.submitterBtcAddress) {
    joinClause = `
      INNER JOIN (
        SELECT DISTINCT bounty_id FROM bounty_submissions
        WHERE submitter_btc_address = ?
      ) s ON s.bounty_id = b.id
    `;
    bindings.unshift(filters.submitterBtcAddress);
  }
  if (filters.posterBtcAddress) {
    conditions.push("b.poster_btc_address = ?");
    bindings.push(filters.posterBtcAddress);
  }
  if (filters.tag) {
    // Tags are stored as a JSON array; use SQLite JSON1 to test array
    // membership semantically instead of LIKE-on-JSON-string.
    conditions.push("EXISTS (SELECT 1 FROM json_each(b.tags) WHERE value = ?)");
    bindings.push(filters.tag);
  }

  const whereClause = conditions.join(" AND ");

  // Total count (for pagination UI). Pulled in same code path to keep it
  // honest — D1 cost is the count plus the page, no extra round-trips.
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM bounties b ${joinClause} WHERE ${whereClause}`)
    .bind(...bindings)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const pageRows = await db
    .prepare(
      `SELECT ${BOUNTY_COLUMNS.split(",").map((c) => `b.${c.trim()}`).join(", ")}
       FROM bounties b
       ${joinClause}
       WHERE ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...bindings, limit, offset)
    .all<D1BountyRow>();

  return {
    bounties: (pageRows.results ?? []).map(rowToBounty),
    total,
  };
}

// ---------------------------------------------------------------------------
// Bounty writes
// ---------------------------------------------------------------------------

/** Insert a new bounty. Throws on duplicate id. */
export async function insertBounty(
  db: D1Database,
  bounty: BountyRecord
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bounties (
        id, poster_btc_address, poster_stx_address, title, description,
        reward_sats, submission_count, created_at, expires_at, updated_at, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      bounty.id,
      bounty.posterBtcAddress,
      bounty.posterStxAddress,
      bounty.title,
      bounty.description,
      bounty.rewardSats,
      bounty.submissionCount,
      bounty.createdAt,
      bounty.expiresAt,
      bounty.updatedAt,
      bounty.tags && bounty.tags.length > 0 ? JSON.stringify(bounty.tags) : null
    )
    .run();
}

/**
 * Mark a bounty as accepted with a chosen submission.
 *
 * The WHERE clause guards against concurrent acceptance — only flips a bounty
 * that still has no `accepted_at` and isn't cancelled or paid.
 *
 * Returns `true` when the row was updated, `false` when the bounty was not in
 * an acceptable state (race, already accepted, etc.).
 */
export async function setAccepted(
  db: D1Database,
  bountyId: string,
  submissionId: string,
  acceptedAt: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE bounties
       SET accepted_submission_id = ?, accepted_at = ?, updated_at = ?
       WHERE id = ?
         AND accepted_at IS NULL
         AND cancelled_at IS NULL
         AND paid_at IS NULL`
    )
    .bind(submissionId, acceptedAt, acceptedAt, bountyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Mark a bounty as paid with the verified payout txid.
 *
 * Guarded by `accepted_at IS NOT NULL AND paid_at IS NULL` so a bounty can
 * only be flipped to paid from `winner-announced`. The unique partial index
 * on `paid_txid` enforces one-txid-per-bounty at the DB level.
 */
export async function setPaid(
  db: D1Database,
  bountyId: string,
  paidTxid: string,
  paidAt: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE bounties
       SET paid_txid = ?, paid_at = ?, updated_at = ?
       WHERE id = ?
         AND accepted_at IS NOT NULL
         AND paid_at IS NULL
         AND cancelled_at IS NULL`
    )
    .bind(paidTxid, paidAt, paidAt, bountyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Cancel a bounty. Allowed only when no acceptance has happened — once a
 * winner is picked, the poster must follow through (or let the pay-grace
 * expire and the bounty flip to `abandoned`).
 */
export async function setCancelled(
  db: D1Database,
  bountyId: string,
  cancelledAt: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE bounties
       SET cancelled_at = ?, updated_at = ?
       WHERE id = ?
         AND cancelled_at IS NULL
         AND paid_at IS NULL
         AND accepted_at IS NULL`
    )
    .bind(cancelledAt, cancelledAt, bountyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Submission reads + writes
// ---------------------------------------------------------------------------

const SUBMISSION_COLUMNS = `
  id, bounty_id, submitter_btc_address, submitter_stx_address,
  content_url, message, created_at
`;

export async function getSubmission(
  db: D1Database,
  submissionId: string
): Promise<BountySubmission | null> {
  const row = await db
    .prepare(`SELECT ${SUBMISSION_COLUMNS} FROM bounty_submissions WHERE id = ? LIMIT 1`)
    .bind(submissionId)
    .first<D1SubmissionRow>();
  return row ? rowToSubmission(row) : null;
}

export interface ListSubmissionsResult {
  submissions: BountySubmission[];
  total: number;
}

export async function listSubmissionsForBounty(
  db: D1Database,
  bountyId: string,
  limit = 20,
  offset = 0
): Promise<ListSubmissionsResult> {
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  const cappedOffset = Math.max(offset, 0);

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM bounty_submissions WHERE bounty_id = ?`)
    .bind(bountyId)
    .first<{ cnt: number }>();

  const pageRows = await db
    .prepare(
      `SELECT ${SUBMISSION_COLUMNS} FROM bounty_submissions
       WHERE bounty_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`
    )
    .bind(bountyId, cappedLimit, cappedOffset)
    .all<D1SubmissionRow>();

  return {
    submissions: (pageRows.results ?? []).map(rowToSubmission),
    total: countRow?.cnt ?? 0,
  };
}

/**
 * List a single agent's submissions, optionally restricted to one bounty
 * (used by the `yourSubmissions` decoration on `?submitter=` list responses).
 */
export async function listSubmissionsBySubmitter(
  db: D1Database,
  submitterBtcAddress: string,
  bountyIds?: string[]
): Promise<BountySubmission[]> {
  if (bountyIds && bountyIds.length === 0) return [];
  let sql = `SELECT ${SUBMISSION_COLUMNS} FROM bounty_submissions WHERE submitter_btc_address = ?`;
  const bindings: (string | number)[] = [submitterBtcAddress];
  if (bountyIds && bountyIds.length > 0) {
    const placeholders = bountyIds.map(() => "?").join(", ");
    sql += ` AND bounty_id IN (${placeholders})`;
    bindings.push(...bountyIds);
  }
  sql += " ORDER BY created_at DESC";
  const rows = await db.prepare(sql).bind(...bindings).all<D1SubmissionRow>();
  return (rows.results ?? []).map(rowToSubmission);
}

/**
 * Insert a submission and bump the parent bounty's `submission_count`.
 *
 * Uses D1 batch so the two writes commit together. If `submission_count`
 * gets out of sync with COUNT(*) for any reason (e.g. backfill), it's a
 * cosmetic display number — the source-of-truth count is the row count.
 */
export async function insertSubmission(
  db: D1Database,
  submission: BountySubmission,
  bountyUpdatedAt: string
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO bounty_submissions (
          id, bounty_id, submitter_btc_address, submitter_stx_address,
          content_url, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        submission.id,
        submission.bountyId,
        submission.submitterBtcAddress,
        submission.submitterStxAddress,
        submission.contentUrl ?? null,
        submission.message,
        submission.createdAt
      ),
    db
      .prepare(
        `UPDATE bounties
         SET submission_count = submission_count + 1, updated_at = ?
         WHERE id = ?`
      )
      .bind(bountyUpdatedAt, submission.bountyId),
  ]);
}

/** Quick existence check used by the self-submit guard. */
export async function hasSubmission(
  db: D1Database,
  bountyId: string,
  submitterBtcAddress: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM bounty_submissions
       WHERE bounty_id = ? AND submitter_btc_address = ?
       LIMIT 1`
    )
    .bind(bountyId, submitterBtcAddress)
    .first<{ x: number }>();
  return row != null;
}
