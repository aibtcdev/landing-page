/**
 * D1 helpers for the bounty system.
 *
 * D1 is the sole source of truth (post-Phase 2.5 / PR #745). There is no KV
 * mirror of bounty records. Hot reads get an edge cache; reverse indexes are
 * SQL queries with proper indexes (see `migrations/013_bounties.sql`).
 *
 * Status is derived, not stored. The list helper accepts a `BountyStatus`
 * filter and compiles it to the matching SQL predicate via `statusToSql`.
 */

import type {
  BountyPayout,
  BountyRecord,
  BountyStatus,
  BountySubmission,
  BountyTeamMember,
} from "./types";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "./constants";
import { splitReward } from "./types";

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
  opens_at: string | null;
  accepted_submission_id: string | null;
  accepted_at: string | null;
  paid_txid: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  ruling_url: string | null;
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

interface D1MemberRow {
  submission_id: string;
  bounty_id: string;
  member_btc_address: string;
  member_stx_address: string;
  role: "lead" | "member";
  share_sats: number;
  confirmed_at: string | null;
  paid_txid: string | null;
  paid_at: string | null;
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
    ...(row.opens_at != null && { opensAt: row.opens_at }),
    ...(row.accepted_submission_id != null && {
      acceptedSubmissionId: row.accepted_submission_id,
    }),
    ...(row.accepted_at != null && { acceptedAt: row.accepted_at }),
    ...(row.paid_txid != null && { paidTxid: row.paid_txid }),
    ...(row.paid_at != null && { paidAt: row.paid_at }),
    ...(row.cancelled_at != null && { cancelledAt: row.cancelled_at }),
    ...(row.cancel_reason != null && { cancelReason: row.cancel_reason }),
    ...(row.ruling_url != null && { rulingUrl: row.ruling_url }),
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

function rowToMember(row: D1MemberRow): BountyTeamMember {
  return {
    btcAddress: row.member_btc_address,
    stxAddress: row.member_stx_address,
    role: row.role,
    shareSats: row.share_sats,
    confirmed: row.confirmed_at != null,
    ...(row.confirmed_at != null && { confirmedAt: row.confirmed_at }),
    ...(row.paid_txid != null && { paidTxid: row.paid_txid }),
    ...(row.paid_at != null && { paidAt: row.paid_at }),
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
    case "scheduled":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND opens_at > ?",
        bindings: [nowIso],
      };
    case "open":
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL AND expires_at > ? AND (opens_at IS NULL OR opens_at <= ?)",
        bindings: [nowIso, nowIso],
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
      // Half-open intervals: `t >= expires_at + ACCEPT_GRACE_MS` (no winner)
      // or `t >= accepted_at + PAY_GRACE_MS` (winner picked, no payment).
      // Rewritten: `expires_at <= acceptCutoff` / `accepted_at <= payCutoff`.
      // Matches `bountyStatus()` in lib/bounty/types.ts at the exact tick.
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND ((accepted_at IS NULL AND expires_at <= ?) OR (accepted_at IS NOT NULL AND accepted_at <= ?))",
        bindings: [acceptCutoffIso, payCutoffIso],
      };
    case "cancelled":
      return { sql: "cancelled_at IS NOT NULL", bindings: [] };
    case "active":
      // Non-terminal only: open + judging + winner-announced. `abandoned` is
      // terminal but leaves cancelled_at and paid_at NULL, so it has to be
      // excluded explicitly or dead bounties leak onto the live board.
      // Written as the positive complement of the `abandoned` predicate above
      // rather than a NOT(...) wrapper, so NULL accepted_at never yields NULL.
      return {
        sql:
          "cancelled_at IS NULL AND paid_at IS NULL AND ((accepted_at IS NULL AND expires_at > ?) OR (accepted_at IS NOT NULL AND accepted_at > ?))",
        bindings: [acceptCutoffIso, payCutoffIso],
      };
    case undefined:
      return { sql: "1=1", bindings: [] };
  }
}

// ---------------------------------------------------------------------------
// Bounty reads
// ---------------------------------------------------------------------------

const BOUNTY_COLUMNS = `
  id, poster_btc_address, poster_stx_address, title, description,
  reward_sats, submission_count, created_at, expires_at, opens_at,
  accepted_submission_id, accepted_at, paid_txid, paid_at,
  cancelled_at, cancel_reason, ruling_url, updated_at, tags
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
  /** Filter to bounties this agent has an entry on, as lead or confirmed teammate (via JOIN). */
  submitterBtcAddress?: string;
  /** JSON-array tag filter — exact match on any tag in the JSON array. */
  tag?: string;
  limit?: number;
  offset?: number;
  /** Override "now" — used by tests for deterministic status filtering. */
  now?: Date;
  /**
   * Run a second COUNT(*) query for paginated UIs. Defaults to `false` — D1
   * bills row reads and the active-bounties index would still scan every live
   * row on each cache miss. When false, `total` is derived as
   * `pageRows.length + offset`, which is exact for `total <= offset + limit`
   * (the common single-page case).
   */
  withCount?: boolean;
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

  // No internal default — callers who want active-only must pass it
  // explicitly. The /bounty UI page wants everything (chip filters drive
  // the view); the /api/bounties GET handler has its own default-to-active
  // applied before calling. An undefined here means "no status filter."
  const statusFrag = statusToSql(filters.status, now);
  const conditions: string[] = [statusFrag.sql];
  const bindings: (string | number)[] = [...statusFrag.bindings];

  let joinClause = "";
  if (filters.submitterBtcAddress) {
    // Bounties this agent has an entry on; a pending invite is not an entry.
    const q = entriesSql([filters.submitterBtcAddress]);
    joinClause = `
      INNER JOIN (SELECT DISTINCT bounty_id FROM (${q.sql})) s ON s.bounty_id = b.id
    `;
    bindings.unshift(...q.bindings);
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

  const rows = pageRows.results ?? [];
  let total = rows.length + offset;
  if (filters.withCount) {
    const countRow = await db
      .prepare(`SELECT COUNT(*) AS cnt FROM bounties b ${joinClause} WHERE ${whereClause}`)
      .bind(...bindings)
      .first<{ cnt: number }>();
    total = countRow?.cnt ?? total;
  }

  return {
    bounties: rows.map(rowToBounty),
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
        reward_sats, submission_count, created_at, expires_at, opens_at, updated_at, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      bounty.opensAt ?? null,
      bounty.updatedAt,
      bounty.tags && bounty.tags.length > 0 ? JSON.stringify(bounty.tags) : null
    )
    .run();
}

/**
 * Mark a bounty as accepted with a chosen submission.
 *
 * A team submission can only be accepted once every member has confirmed:
 * the member check is in the same UPDATE, so a race cannot slip an
 * unconfirmed team through.
 *
 * The WHERE clause guards against concurrent acceptance — only flips a bounty
 * that still has no `accepted_at` and isn't cancelled or paid. The
 * `expires_at > acceptCutoff` predicate closes the TOCTOU window where a
 * request straddling the 14-day accept-grace cutoff could resurrect an
 * `abandoned` bounty (terminal state is now SQL-enforced, not just
 * read-time-derived).
 *
 * Returns `true` when the row was updated, `false` when the bounty was not in
 * an acceptable state (race, already accepted, past the abandonment cutoff).
 */
export async function setAccepted(
  db: D1Database,
  bountyId: string,
  submissionId: string,
  acceptedAt: string
): Promise<boolean> {
  const acceptCutoff = new Date(Date.parse(acceptedAt) - ACCEPT_GRACE_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE bounties
       SET accepted_submission_id = ?, accepted_at = ?, updated_at = ?
       WHERE id = ?
         AND accepted_at IS NULL
         AND cancelled_at IS NULL
         AND paid_at IS NULL
         AND expires_at > ?
         AND EXISTS (SELECT 1 FROM bounty_submission_members WHERE submission_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM bounty_submission_members
           WHERE submission_id = ? AND confirmed_at IS NULL
         )`
    )
    .bind(submissionId, acceptedAt, acceptedAt, bountyId, acceptCutoff, submissionId, submissionId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Record verified payouts to members of the accepted submission, and flip the
 * bounty to paid once no member is left unpaid.
 *
 * One D1 batch (a transaction). Each member row is written only while the
 * bounty is accepted, unpaid, not cancelled and inside the pay-grace window,
 * and only if that member is still unpaid. `payCutoff` is computed from
 * `paidAt` (the verified on-chain block time, not wall-clock arrival time), so
 * a payment that landed inside `[accepted_at - 60s, accepted_at + PAY_GRACE_MS)`
 * is accepted even if the proof arrives after `PAY_GRACE_MS` elapsed (#1110).
 *
 * `bounties.paid_txid` is the txid that completed the payout; for a solo
 * entry that is its only payment, as before. It is not unique: one txid may
 * pay members of several bounties, each transfer bound to its bounty by the
 * BNTY memo. What stops a transfer counting twice is the unique index on
 * (paid_txid, paid_event_index); a repeat throws and the batch rolls back.
 *
 * Returns how many member rows were written and whether the bounty is now paid.
 */
export async function recordMemberPayments(
  db: D1Database,
  params: {
    bountyId: string;
    submissionId: string;
    txid: string;
    /** Verified on-chain block time of the payment. */
    paidAt: string;
    payments: { btcAddress: string; eventIndex: number | null }[];
  }
): Promise<{ recorded: number; bountyPaid: boolean }> {
  const payCutoff = new Date(Date.parse(params.paidAt) - PAY_GRACE_MS).toISOString();
  const nowIso = new Date().toISOString();
  const bountyAcceptedUnpaid = `EXISTS (
    SELECT 1 FROM bounties
    WHERE id = ? AND accepted_submission_id = ? AND accepted_at IS NOT NULL
      AND paid_at IS NULL AND cancelled_at IS NULL AND accepted_at > ?
  )`;
  const memberWrites = params.payments.map((p) =>
    db
      .prepare(
        `UPDATE bounty_submission_members
         SET paid_txid = ?, paid_event_index = ?, paid_at = ?
         WHERE submission_id = ? AND member_btc_address = ? AND paid_txid IS NULL
           AND ${bountyAcceptedUnpaid}`
      )
      .bind(
        params.txid,
        p.eventIndex,
        params.paidAt,
        params.submissionId,
        p.btcAddress,
        params.bountyId,
        params.submissionId,
        payCutoff
      )
  );
  const bountyWrite = db
    .prepare(
      `UPDATE bounties
       SET paid_txid = ?, paid_at = ?, updated_at = ?
       WHERE id = ?
         AND accepted_submission_id = ?
         AND accepted_at IS NOT NULL
         AND paid_at IS NULL
         AND cancelled_at IS NULL
         AND accepted_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM bounty_submission_members
           WHERE submission_id = ? AND paid_txid IS NULL
         )`
    )
    .bind(
      params.txid,
      params.paidAt,
      nowIso,
      params.bountyId,
      params.submissionId,
      payCutoff,
      params.submissionId
    );
  const results = await db.batch([...memberWrites, bountyWrite]);
  const recorded = results
    .slice(0, memberWrites.length)
    .reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  const bountyPaid = (results[memberWrites.length].meta?.changes ?? 0) > 0;
  // A partial payout still changes what the bounty shows, so clients syncing
  // on updatedAt must see it; a call that recorded nothing changes nothing.
  if (recorded > 0 && !bountyPaid) {
    await db
      .prepare(`UPDATE bounties SET updated_at = ? WHERE id = ?`)
      .bind(nowIso, params.bountyId)
      .run();
  }
  return { recorded, bountyPaid };
}

/**
 * Cancel a bounty. Allowed only when no acceptance has happened and the
 * bounty hasn't already passed the abandonment cutoff — once that's true,
 * `bountyStatus()` reports `abandoned` (terminal) and the spec says cancel
 * cannot resurrect it.
 */
export async function setCancelled(
  db: D1Database,
  bountyId: string,
  cancelledAt: string,
  reason?: string,
  rulingUrl?: string
): Promise<boolean> {
  const acceptCutoff = new Date(Date.parse(cancelledAt) - ACCEPT_GRACE_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE bounties
       SET cancelled_at = ?, cancel_reason = ?, ruling_url = ?, updated_at = ?
       WHERE id = ?
         AND cancelled_at IS NULL
         AND paid_at IS NULL
         AND accepted_at IS NULL
         AND expires_at > ?`
    )
    .bind(cancelledAt, reason ?? null, rulingUrl ?? null, cancelledAt, bountyId, acceptCutoff)
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
  offset = 0,
  knownTotal?: number
): Promise<ListSubmissionsResult> {
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  const cappedOffset = Math.max(offset, 0);

  // Prefer the parent bounty's maintained `submission_count` (bumped
  // transactionally on every insert — see insertSubmission) when the caller
  // supplies it, avoiding a COUNT(*) scan of all submissions per request.
  // Every caller already loads the bounty, so this is a pure win.
  let total = knownTotal;
  if (total === undefined) {
    const countRow = await db
      .prepare(`SELECT COUNT(*) AS cnt FROM bounty_submissions WHERE bounty_id = ?`)
      .bind(bountyId)
      .first<{ cnt: number }>();
    total = countRow?.cnt ?? 0;
  }

  const pageRows = await db
    .prepare(
      `SELECT ${SUBMISSION_COLUMNS} FROM bounty_submissions
       WHERE bounty_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(bountyId, cappedLimit, cappedOffset)
    .all<D1SubmissionRow>();

  return {
    submissions: (pageRows.results ?? []).map(rowToSubmission),
    total,
  };
}

/**
 * List the agent's entries (submissions they lead or confirmed as a teammate),
 * optionally restricted to some bounties (used by the `yourSubmissions`
 * decoration on `?submitter=` list responses). Pending invites are not
 * entries; they are listed by listPendingConfirms.
 */
export async function listSubmissionsBySubmitter(
  db: D1Database,
  submitterBtcAddress: string,
  bountyIds?: string[]
): Promise<BountySubmission[]> {
  if (bountyIds && bountyIds.length === 0) return [];
  const cols = SUBMISSION_COLUMNS.split(",").map((c) => `s.${c.trim()}`).join(", ");
  let sql = `SELECT ${cols} FROM bounty_submissions s
    WHERE (s.submitter_btc_address = ?
      OR s.id IN (SELECT submission_id FROM bounty_submission_members
                  WHERE member_btc_address = ? AND confirmed_at IS NOT NULL))`;
  const bindings: (string | number)[] = [submitterBtcAddress, submitterBtcAddress];
  if (bountyIds && bountyIds.length > 0) {
    const placeholders = bountyIds.map(() => "?").join(", ");
    sql += ` AND s.bounty_id IN (${placeholders})`;
    bindings.push(...bountyIds);
  }
  sql += " ORDER BY s.created_at DESC";
  const rows = await db.prepare(sql).bind(...bindings).all<D1SubmissionRow>();
  return (rows.results ?? []).map(rowToSubmission);
}

/**
 * Insert a submission with its member rows and bump the parent bounty's
 * `submission_count`.
 *
 * One D1 batch, so it all commits together or not at all. `members` is the
 * whole team, lead first; the lead is confirmed at submit time and teammates
 * are pending until they confirm. The unique index on confirmed
 * (bounty_id, member_btc_address) rejects the batch if the lead entered this
 * bounty concurrently. If `submission_count` gets out of sync with
 * COUNT(*) for any reason (e.g. backfill), it's a cosmetic display number.
 */
export async function insertSubmission(
  db: D1Database,
  submission: BountySubmission,
  bountyUpdatedAt: string,
  members: { btcAddress: string; stxAddress: string; shareSats: number }[]
): Promise<void> {
  const memberRows = members.map((m, i) =>
    db
      .prepare(
        `INSERT INTO bounty_submission_members (
          submission_id, bounty_id, member_btc_address, member_stx_address,
          role, share_sats, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        submission.id,
        submission.bountyId,
        m.btcAddress,
        m.stxAddress,
        i === 0 ? "lead" : "member",
        m.shareSats,
        i === 0 ? submission.createdAt : null
      )
  );
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
    ...memberRows,
    db
      .prepare(
        `UPDATE bounties
         SET submission_count = submission_count + 1, updated_at = ?
         WHERE id = ?`
      )
      .bind(bountyUpdatedAt, submission.bountyId),
  ]);
}

/**
 * THE rule for "this agent has an entry on this bounty", as SQL: a confirmed
 * membership (lead, or teammate who confirmed) or a submission they lead (the
 * second half also covers submissions stored without member rows). A pending
 * invite does not count, so naming an agent as a teammate can never lock that
 * agent out of a bounty. Every "has entered" read goes through here so the
 * submit, confirm, heartbeat and list paths cannot drift apart.
 *
 * Returns `(bounty_id, agent)` rows for the given agents, optionally limited to
 * some bounties, plus the bindings in order. Both halves are index searches
 * (idx_members_agent; idx_submissions_submitter / idx_submissions_bounty).
 */
function entriesSql(agents: string[], bountyIds?: string[]): { sql: string; bindings: string[] } {
  const a = agents.map(() => "?").join(", ");
  const b = bountyIds ? bountyIds.map(() => "?").join(", ") : "";
  const bountyFilter = bountyIds ? ` AND bounty_id IN (${b})` : "";
  return {
    sql: `SELECT bounty_id, member_btc_address AS agent FROM bounty_submission_members
          WHERE confirmed_at IS NOT NULL AND member_btc_address IN (${a})${bountyFilter}
          UNION
          SELECT bounty_id, submitter_btc_address AS agent FROM bounty_submissions
          WHERE submitter_btc_address IN (${a})${bountyFilter}`,
    bindings: [...agents, ...(bountyIds ?? []), ...agents, ...(bountyIds ?? [])],
  };
}

/** Which of `btcAddresses` already have an entry on this bounty (see entriesSql). */
export async function enteredAgents(
  db: D1Database,
  bountyId: string,
  btcAddresses: string[]
): Promise<Set<string>> {
  if (btcAddresses.length === 0) return new Set();
  const q = entriesSql(btcAddresses, [bountyId]);
  const { results } = await db.prepare(q.sql).bind(...q.bindings).all<{ agent: string }>();
  return new Set((results ?? []).map((r) => r.agent));
}

/**
 * Give a submission that has no member rows its lead row. Covers a
 * submission stored by older code after migration 032 ran but before this
 * code deployed. Marked legacy, like the migration backfill. A no-op when
 * the row exists.
 */
export async function ensureLeadMember(
  db: D1Database,
  submission: BountySubmission,
  rewardSats: number
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO bounty_submission_members
         (submission_id, bounty_id, member_btc_address, member_stx_address, role,
          share_sats, confirmed_at, legacy)
       SELECT ?, ?, ?, ?, 'lead', ?, ?, 1
       WHERE NOT EXISTS (SELECT 1 FROM bounty_submission_members WHERE submission_id = ?)`
    )
    .bind(
      submission.id,
      submission.bountyId,
      submission.submitterBtcAddress,
      submission.submitterStxAddress,
      rewardSats,
      submission.createdAt,
      submission.id
    )
    .run();
}

/** Team members of each submission, lead first, keyed by submission id. */
export async function listMembers(
  db: D1Database,
  submissionIds: string[]
): Promise<Map<string, BountyTeamMember[]>> {
  const out = new Map<string, BountyTeamMember[]>();
  if (submissionIds.length === 0) return out;
  const placeholders = submissionIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT submission_id, bounty_id, member_btc_address, member_stx_address,
              role, share_sats, confirmed_at, paid_txid, paid_at
       FROM bounty_submission_members
       WHERE submission_id IN (${placeholders})
       ORDER BY submission_id, CASE role WHEN 'lead' THEN 0 ELSE 1 END, rowid`
    )
    .bind(...submissionIds)
    .all<D1MemberRow>();
  for (const row of results ?? []) {
    const list = out.get(row.submission_id) ?? [];
    list.push(rowToMember(row));
    out.set(row.submission_id, list);
  }
  return out;
}

/** Attach `team` and `teamStatus` to submissions (one query for the page). */
export async function withTeams(
  db: D1Database,
  submissions: BountySubmission[]
): Promise<BountySubmission[]> {
  const teams = await listMembers(db, submissions.map((s) => s.id));
  return submissions.map((s) => {
    const team = teams.get(s.id) ?? [];
    // No member rows: a solo entry stored by older code (see ensureLeadMember).
    return {
      ...s,
      teamSize: team.length || 1,
      team,
      teamStatus: team.every((m) => m.confirmed) ? "confirmed" : "pending",
    };
  });
}

/**
 * Mark one member of a submission as confirmed. Returns true when this call
 * confirmed them, false when they were already confirmed or are not a member.
 */
export async function confirmMember(
  db: D1Database,
  submissionId: string,
  btcAddress: string,
  confirmedAt: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE bounty_submission_members SET confirmed_at = ?
       WHERE submission_id = ? AND member_btc_address = ? AND confirmed_at IS NULL`
    )
    .bind(confirmedAt, submissionId, btcAddress)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Remove a pending (unconfirmed) member from a submission and re-split the
 * reward evenly across the members left, lead first. One batch, so the
 * removal and the new shares commit together; every write requires the
 * bounty to still have no winner, so a removal cannot race an acceptance.
 * Returns false when nothing was removed (already confirmed, not a member,
 * or the bounty moved on).
 */
export async function removePendingMember(
  db: D1Database,
  params: {
    bountyId: string;
    submissionId: string;
    memberBtcAddress: string;
    rewardSats: number;
    /** Members who stay, lead first, in their stored order. */
    remaining: string[];
  }
): Promise<boolean> {
  const open = `EXISTS (SELECT 1 FROM bounties WHERE id = ? AND accepted_at IS NULL
                        AND cancelled_at IS NULL AND paid_at IS NULL)`;
  const shares = splitReward(params.rewardSats, params.remaining.length);
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM bounty_submission_members
         WHERE submission_id = ? AND member_btc_address = ? AND confirmed_at IS NULL
           AND role = 'member' AND ${open}`
      )
      .bind(params.submissionId, params.memberBtcAddress, params.bountyId),
    ...params.remaining.map((addr, i) =>
      db
        .prepare(
          // Re-split only if the removal above actually happened.
          `UPDATE bounty_submission_members SET share_sats = ?
           WHERE submission_id = ? AND member_btc_address = ? AND ${open}
             AND NOT EXISTS (SELECT 1 FROM bounty_submission_members
                             WHERE submission_id = ? AND member_btc_address = ?)`
        )
        .bind(shares[i], params.submissionId, addr, params.bountyId, params.submissionId, params.memberBtcAddress)
    ),
  ]);
  return (results[0].meta?.changes ?? 0) > 0;
}

/** Payout progress of a team: who is paid, who is still owed and how much. */
export function buildPayout(team: BountyTeamMember[]): BountyPayout {
  const unpaid = team.filter((m) => !m.paidTxid);
  return {
    membersTotal: team.length,
    membersPaid: team.length - unpaid.length,
    unpaid: unpaid.map((m) => ({
      btcAddress: m.btcAddress,
      stxAddress: m.stxAddress,
      amountSats: m.shareSats,
    })),
  };
}

export interface PendingTeamConfirm {
  bountyId: string;
  bountyTitle: string;
  rewardSats: number;
  expiresAt: string;
  submissionId: string;
  leadBtcAddress: string;
  /** Omitted when the caller skips it (the heartbeat). */
  teamSize?: number;
  shareSats: number;
}

/**
 * Team entries waiting for this agent's confirmation that they can actually
 * confirm: the bounty still accepts confirmations (no winner picked, not
 * cancelled or paid, not past the accept-grace cutoff) and the agent has no
 * entry on it yet (an invite they could only answer with 409 is left out).
 *
 * `limit` bounds the read; the heartbeat asks for a few and skips the team
 * size. The first query reads the small idx_members_pending; the entry check
 * runs only when there are pending rows.
 */
export async function listPendingConfirms(
  db: D1Database,
  btcAddress: string,
  options: { limit?: number; withTeamSize?: boolean; now?: Date } = {}
): Promise<PendingTeamConfirm[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
  const now = options.now ?? new Date();
  const acceptCutoff = new Date(now.getTime() - ACCEPT_GRACE_MS).toISOString();
  const teamSizeCol = options.withTeamSize === false
    ? "0 AS team_size"
    : "(SELECT COUNT(*) FROM bounty_submission_members t WHERE t.submission_id = s.id) AS team_size";
  const { results } = await db
    .prepare(
      `SELECT b.id AS bounty_id, b.title, b.reward_sats, b.expires_at,
              s.id AS submission_id, s.submitter_btc_address, m.share_sats, ${teamSizeCol}
       FROM bounty_submission_members m
       JOIN bounty_submissions s ON s.id = m.submission_id
       JOIN bounties b ON b.id = m.bounty_id
       WHERE m.member_btc_address = ? AND m.confirmed_at IS NULL
         AND b.accepted_at IS NULL AND b.cancelled_at IS NULL AND b.paid_at IS NULL
         AND b.expires_at > ?
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .bind(btcAddress, acceptCutoff, limit)
    .all<{
      bounty_id: string;
      title: string;
      reward_sats: number;
      expires_at: string;
      submission_id: string;
      submitter_btc_address: string;
      team_size: number;
      share_sats: number;
    }>();
  const rows = results ?? [];
  if (rows.length === 0) return [];
  const entered = await submittedBountyIds(db, btcAddress, [...new Set(rows.map((r) => r.bounty_id))]);
  return rows.filter((r) => !entered.has(r.bounty_id)).map((r) => ({
    bountyId: r.bounty_id,
    bountyTitle: r.title,
    rewardSats: r.reward_sats,
    expiresAt: r.expires_at,
    submissionId: r.submission_id,
    leadBtcAddress: r.submitter_btc_address,
    ...(options.withTeamSize !== false && { teamSize: r.team_size }),
    shareSats: r.share_sats,
  }));
}

/**
 * Which of `bountyIds` this agent has already submitted to. One indexed read
 * (`idx_members_agent`) for a small candidate set, used to keep the
 * heartbeat from pointing an agent at a bounty the submit route would refuse
 * with 409 `already_submitted`.
 */
export async function submittedBountyIds(
  db: D1Database,
  submitterBtcAddress: string,
  bountyIds: string[]
): Promise<Set<string>> {
  if (bountyIds.length === 0) return new Set();
  const q = entriesSql([submitterBtcAddress], bountyIds);
  const { results } = await db.prepare(q.sql).bind(...q.bindings).all<{ bounty_id: string }>();
  return new Set((results ?? []).map((r) => r.bounty_id));
}

// ── Submit attempts (#1040) ───────────────────────────────────────────────

export type SubmitAttemptOutcome = "not_registered" | "closed" | "store_failed";

export interface SubmitAttemptCounts {
  /** Distinct agents on a stored entry: leads plus teammates who confirmed. */
  submitted: number;
  /** Distinct signers refused for each reason who never went on to submit. */
  refused: Record<SubmitAttemptOutcome, number>;
}

/**
 * Upsert a refused, signature-verified submit attempt. A no-op when the bounty
 * does not exist. Callers treat this as best-effort and must not fail the
 * request on error.
 */
export async function recordSubmitAttempt(
  db: D1Database,
  bountyId: string,
  submitterBtcAddress: string,
  outcome: SubmitAttemptOutcome,
  nowIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bounty_submit_attempts
         (bounty_id, submitter_btc_address, outcome, attempt_count, first_attempted_at, last_attempted_at)
       SELECT ?, ?, ?, 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM bounties WHERE id = ?)
       ON CONFLICT (bounty_id, submitter_btc_address, outcome) DO UPDATE SET
         attempt_count = attempt_count + 1,
         last_attempted_at = excluded.last_attempted_at`
    )
    .bind(bountyId, submitterBtcAddress, outcome, nowIso, nowIso, bountyId)
    .run();
}

/**
 * Count agents on entries and refused attempts for one bounty. A team entry
 * counts each lead and each teammate who confirmed. Signers who were refused
 * but later entered are counted only as submitted. `fallbackSubmitted` (the
 * entry count) is used if the agent count cannot be read.
 */
export async function getSubmitAttemptCounts(
  db: D1Database,
  bountyId: string,
  fallbackSubmitted: number
): Promise<SubmitAttemptCounts> {
  const [{ results }, agents] = await Promise.all([
    db
      .prepare(
        `SELECT a.outcome AS outcome, COUNT(DISTINCT a.submitter_btc_address) AS n
         FROM bounty_submit_attempts a
         WHERE a.bounty_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM bounty_submission_members m
             WHERE m.bounty_id = a.bounty_id
               AND m.member_btc_address = a.submitter_btc_address
               AND m.confirmed_at IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM bounty_submissions s
             WHERE s.bounty_id = a.bounty_id
               AND s.submitter_btc_address = a.submitter_btc_address
           )
         GROUP BY a.outcome`
      )
      .bind(bountyId)
      .all<{ outcome: SubmitAttemptOutcome; n: number }>(),
    db
      .prepare(
        // Reaches members through this bounty's submissions (idx_submissions_bounty,
        // then the member primary key), so it reads only this bounty's rows. A
        // bounty_id filter on the members table has no usable index and would
        // scan every member row on each detail read.
        `SELECT COUNT(*) AS n FROM (
           SELECT m.member_btc_address FROM bounty_submissions s
           JOIN bounty_submission_members m ON m.submission_id = s.id
           WHERE s.bounty_id = ? AND m.confirmed_at IS NOT NULL
           UNION
           SELECT submitter_btc_address FROM bounty_submissions WHERE bounty_id = ?
         )`
      )
      .bind(bountyId, bountyId)
      .first<{ n: number }>()
      .catch(() => null),
  ]);
  const submittedCount = agents?.n ?? fallbackSubmitted;

  const refused: Record<SubmitAttemptOutcome, number> = {
    not_registered: 0,
    closed: 0,
    store_failed: 0,
  };
  for (const row of results ?? []) {
    if (row.outcome in refused) refused[row.outcome] = row.n;
  }
  return { submitted: submittedCount, refused };
}
