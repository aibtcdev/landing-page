/**
 * Maintained-counter helpers for agent_inbox_stats.
 *
 * This module provides O(1) stat reads and idempotent counter writes to
 * replace live SELECT COUNT(*) queries against inbox_messages on every
 * hot path.
 *
 * ## Write-path idempotency
 *
 * Every bump helper must ONLY be called when the underlying inbox_messages
 * row was actually inserted/updated. Callers pass the D1Result.meta.changes
 * value from the preceding INSERT or UPDATE and check === 1 before calling:
 *
 *   const result = await insertInboundMessageToD1(db, message);
 *   if (result.changes === 1) {
 *     await bumpInboundStats(db, message.toBtcAddress, message.sentAt);
 *   }
 *
 * This guarantees that retried or duplicate writes never double-count.
 *
 * ## Counter lower-bound safety
 *
 * decrementUnreadStats uses MAX(0, unread_count - 1) so duplicate mark-read
 * attempts cannot push unread_count negative. The calling convention (only
 * call when changes === 1 from the read_at update) is the primary guard;
 * the MAX(0, ...) is a belt-and-suspenders floor.
 *
 * ## Repair path
 *
 * rebuildAllStats() is idempotent: it aggregates from inbox_messages and
 * UPSERTs every stats row. Run it after admin/backfill mutations that bypass
 * the write-path helpers.
 *
 * ## Quest context
 *
 * P3 of quest 2026-05-13-d1-count-bill-stop. Addresses feedback memory
 * feedback_d1_count_antipattern: D1 is pay-per-row-scanned; COUNT(*) walks
 * every matching row; use maintained counter tables instead.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/741 (#741 disposition)
 * See: https://github.com/aibtcdev/landing-page/issues/724 (#724 coverage)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved stats for a single agent. All numeric fields default to 0. */
export interface AgentInboxStats {
  receivedCount: number;
  unreadCount: number;
  sentCount: number;
  lastMessageAt: string | null;
  lastSentAt: string | null;
}

/** Row shape returned by D1 from agent_inbox_stats. */
interface StatsRow {
  received_count: number;
  unread_count: number;
  sent_count: number;
  last_message_at: string | null;
  last_sent_at: string | null;
}

/** Result of reconcileStats() comparing stats table to live inbox_messages. */
export interface ReconciliationResult {
  mismatchCount: number;
  samples: ReconciliationSample[];
}

interface ReconciliationSample {
  btcAddress: string;
  statsReceived: number;
  actualReceived: number;
  statsUnread: number;
  actualUnread: number;
  statsSent: number;
  actualSent: number;
}

/** Row shape for reconciliation aggregate query. */
interface ReconcileRow {
  btc_address: string;
  stats_received: number;
  actual_received: number;
  stats_unread: number;
  actual_unread: number;
  stats_sent: number;
  actual_sent: number;
}

// ---------------------------------------------------------------------------
// Read helper
// ---------------------------------------------------------------------------

/** Zero-valued stats returned when no row exists for this address. */
const ZERO_STATS: AgentInboxStats = {
  receivedCount: 0,
  unreadCount: 0,
  sentCount: 0,
  lastMessageAt: null,
  lastSentAt: null,
};

/**
 * Fetch stats for a single agent. Returns zeroed defaults when:
 *   - db is undefined (binding not available)
 *   - the agent has no stats row (no messages yet)
 *   - D1 throws a transient error (fail-open)
 *
 * Always returns a defined AgentInboxStats value — callers never need to
 * handle null.
 */
export async function getAgentInboxStats(
  db: D1Database | undefined,
  btcAddress: string
): Promise<AgentInboxStats> {
  if (!db) return { ...ZERO_STATS };
  try {
    const row = await db
      .prepare(
        `SELECT received_count, unread_count, sent_count, last_message_at, last_sent_at
         FROM agent_inbox_stats
         WHERE btc_address = ?`
      )
      .bind(btcAddress)
      .first<StatsRow>();

    if (!row) return { ...ZERO_STATS };

    return {
      receivedCount: row.received_count,
      unreadCount: row.unread_count,
      sentCount: row.sent_count,
      lastMessageAt: row.last_message_at,
      lastSentAt: row.last_sent_at,
    };
  } catch {
    // Fail-open: a transient D1 error must not block heartbeat or inbox reads.
    return { ...ZERO_STATS };
  }
}

// ---------------------------------------------------------------------------
// Write helpers (idempotent — only call when changes === 1)
// ---------------------------------------------------------------------------

/**
 * Increment received_count and unread_count for an agent on a new inbound
 * message delivery.
 *
 * MUST only be called when the preceding insertInboundMessageToD1 returned
 * changes === 1 (confirming the row was newly inserted, not a retry/duplicate).
 */
export async function bumpInboundStats(
  db: D1Database,
  btcAddress: string,
  sentAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_inbox_stats
         (btc_address, received_count, unread_count, sent_count,
          last_message_at, updated_at)
       VALUES (?, 1, 1, 0, ?, ?)
       ON CONFLICT(btc_address) DO UPDATE SET
         received_count  = received_count + 1,
         unread_count    = unread_count + 1,
         last_message_at = CASE
           WHEN excluded.last_message_at > last_message_at OR last_message_at IS NULL
           THEN excluded.last_message_at
           ELSE last_message_at
         END,
         updated_at      = excluded.updated_at`
    )
    .bind(btcAddress, sentAt, now)
    .run();
}

/**
 * Increment sent_count for an agent after a reply is successfully stored.
 *
 * MUST only be called when the preceding insertReplyToD1 returned
 * changes === 1.
 */
export async function bumpSentStats(
  db: D1Database,
  fromBtcAddress: string,
  sentAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_inbox_stats
         (btc_address, received_count, unread_count, sent_count,
          last_sent_at, updated_at)
       VALUES (?, 0, 0, 1, ?, ?)
       ON CONFLICT(btc_address) DO UPDATE SET
         sent_count   = sent_count + 1,
         last_sent_at = CASE
           WHEN excluded.last_sent_at > last_sent_at OR last_sent_at IS NULL
           THEN excluded.last_sent_at
           ELSE last_sent_at
         END,
         updated_at   = excluded.updated_at`
    )
    .bind(fromBtcAddress, sentAt, now)
    .run();
}

/**
 * Decrement unread_count for an agent when a message is marked as read.
 *
 * MUST only be called when the preceding mark-read UPDATE (WHERE read_at IS
 * NULL guard) returned changes === 1 — confirming a real unread→read
 * transition, not a duplicate mark-read attempt.
 *
 * Uses MAX(0, unread_count - 1) as a belt-and-suspenders floor so repeated
 * calls cannot push the counter negative.
 */
export async function decrementUnreadStats(
  db: D1Database,
  btcAddress: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE agent_inbox_stats
       SET unread_count = MAX(0, unread_count - 1),
           updated_at   = ?
       WHERE btc_address = ?`
    )
    .bind(now, btcAddress)
    .run();
}

// ---------------------------------------------------------------------------
// Backfill / repair
// ---------------------------------------------------------------------------

/**
 * Idempotent full backfill: recomputes all stats from inbox_messages and
 * UPSERTs into agent_inbox_stats.
 *
 * Safe to run repeatedly. After each run, reconcileStats() should report
 * zero mismatches.
 *
 * Use this:
 *   - After initial migration deployment (before first read-path swaps merge)
 *   - After admin/backfill mutations that bypass the write-path helpers
 *   - As a periodic repair job if drift is detected
 *
 * Returns the number of rows upserted.
 */
export async function rebuildAllStats(db: D1Database): Promise<number> {
  const now = new Date().toISOString();

  // Aggregate received and unread per recipient from inbound rows
  const inboundResult = await db
    .prepare(
      `SELECT
         to_btc_address   AS btc_address,
         COUNT(*)         AS received_count,
         COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
         MAX(sent_at)     AS last_message_at
       FROM inbox_messages
       WHERE is_reply = 0
       GROUP BY to_btc_address`
    )
    .all<{
      btc_address: string;
      received_count: number;
      unread_count: number;
      last_message_at: string | null;
    }>();

  // Aggregate sent count per sender from reply rows
  const sentResult = await db
    .prepare(
      `SELECT
         from_btc_address AS btc_address,
         COUNT(*)         AS sent_count,
         MAX(sent_at)     AS last_sent_at
       FROM inbox_messages
       WHERE is_reply = 1 AND from_btc_address IS NOT NULL
       GROUP BY from_btc_address`
    )
    .all<{
      btc_address: string;
      sent_count: number;
      last_sent_at: string | null;
    }>();

  // Merge into a combined map
  const statsMap = new Map<
    string,
    {
      received: number;
      unread: number;
      sent: number;
      lastMessageAt: string | null;
      lastSentAt: string | null;
    }
  >();

  for (const row of inboundResult.results ?? []) {
    statsMap.set(row.btc_address, {
      received: row.received_count,
      unread: row.unread_count,
      sent: 0,
      lastMessageAt: row.last_message_at,
      lastSentAt: null,
    });
  }

  for (const row of sentResult.results ?? []) {
    const existing = statsMap.get(row.btc_address);
    if (existing) {
      existing.sent = row.sent_count;
      existing.lastSentAt = row.last_sent_at;
    } else {
      statsMap.set(row.btc_address, {
        received: 0,
        unread: 0,
        sent: row.sent_count,
        lastMessageAt: null,
        lastSentAt: row.last_sent_at,
      });
    }
  }

  if (statsMap.size === 0) return 0;

  // Upsert in batches of 50 to stay within D1 statement limits
  const entries = Array.from(statsMap.entries());
  const BATCH_SIZE = 50;
  let upserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const statements = batch.map(([addr, s]) =>
      db
        .prepare(
          `INSERT INTO agent_inbox_stats
             (btc_address, received_count, unread_count, sent_count,
              last_message_at, last_sent_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(btc_address) DO UPDATE SET
             received_count  = excluded.received_count,
             unread_count    = excluded.unread_count,
             sent_count      = excluded.sent_count,
             last_message_at = excluded.last_message_at,
             last_sent_at    = excluded.last_sent_at,
             updated_at      = excluded.updated_at`
        )
        .bind(addr, s.received, s.unread, s.sent, s.lastMessageAt, s.lastSentAt, now)
    );
    await db.batch(statements);
    upserted += batch.length;
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Compare agent_inbox_stats counters to live aggregates from inbox_messages.
 *
 * Returns mismatches only. An empty mismatchCount with empty samples array
 * means the stats table is fully consistent.
 *
 * Run this before and after the read-path swap to confirm correctness.
 * Save the output as an ISO8601-dated artifact.
 *
 * Note: rows in agent_inbox_stats that have no corresponding inbox_messages
 * rows (all-zero edge case) are included if their counters are non-zero.
 * Rows with zero stats and zero actuals are not reported as mismatches.
 */
export async function reconcileStats(
  db: D1Database
): Promise<ReconciliationResult> {
  // Join stats table to live aggregates; surface any row where any counter
  // disagrees. Uses COALESCE so agents with stats but no messages show up.
  const result = await db
    .prepare(
      `SELECT
         s.btc_address,
         s.received_count  AS stats_received,
         s.unread_count    AS stats_unread,
         s.sent_count      AS stats_sent,
         COALESCE(inb.received_count, 0)  AS actual_received,
         COALESCE(inb.unread_count, 0)    AS actual_unread,
         COALESCE(snt.sent_count, 0)      AS actual_sent
       FROM agent_inbox_stats s
       LEFT JOIN (
         SELECT
           to_btc_address AS btc_address,
           COUNT(*) AS received_count,
           COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count
         FROM inbox_messages
         WHERE is_reply = 0
         GROUP BY to_btc_address
       ) inb ON inb.btc_address = s.btc_address
       LEFT JOIN (
         SELECT
           from_btc_address AS btc_address,
           COUNT(*) AS sent_count
         FROM inbox_messages
         WHERE is_reply = 1 AND from_btc_address IS NOT NULL
         GROUP BY from_btc_address
       ) snt ON snt.btc_address = s.btc_address
       WHERE
         s.received_count != COALESCE(inb.received_count, 0)
         OR s.unread_count != COALESCE(inb.unread_count, 0)
         OR s.sent_count   != COALESCE(snt.sent_count, 0)
       LIMIT 50`
    )
    .all<ReconcileRow>();

  const samples: ReconciliationSample[] = (result.results ?? []).map((r) => ({
    btcAddress: r.btc_address,
    statsReceived: r.stats_received,
    actualReceived: r.actual_received,
    statsUnread: r.stats_unread,
    actualUnread: r.actual_unread,
    statsSent: r.stats_sent,
    actualSent: r.actual_sent,
  }));

  // Count mismatching rows (not limited to 50) for the summary
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM agent_inbox_stats s
       LEFT JOIN (
         SELECT
           to_btc_address AS btc_address,
           COUNT(*) AS received_count,
           COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count
         FROM inbox_messages
         WHERE is_reply = 0
         GROUP BY to_btc_address
       ) inb ON inb.btc_address = s.btc_address
       LEFT JOIN (
         SELECT
           from_btc_address AS btc_address,
           COUNT(*) AS sent_count
         FROM inbox_messages
         WHERE is_reply = 1 AND from_btc_address IS NOT NULL
         GROUP BY from_btc_address
       ) snt ON snt.btc_address = s.btc_address
       WHERE
         s.received_count != COALESCE(inb.received_count, 0)
         OR s.unread_count != COALESCE(inb.unread_count, 0)
         OR s.sent_count   != COALESCE(snt.sent_count, 0)`
    )
    .first<{ cnt: number }>();

  return {
    mismatchCount: countResult?.cnt ?? 0,
    samples,
  };
}
