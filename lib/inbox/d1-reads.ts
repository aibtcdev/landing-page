/**
 * D1 read helpers for GET /api/inbox/[address] and sibling routes.
 *
 * Phase 2.5 Step 3.1 — flip inbox-list GET from KV reads to D1 SELECTs.
 * Phase 2.5 Step 3.2 — adds getInboxMessageFromD1 for the single-message GET.
 * Phase 2.5 Step 3.3 — adds listOutboxRepliesFromD1 + countOutboxRepliesFromD1
 *   for the outbox GET flip and sentCount/partners restoration in inbox-list.
 * Phase 2.5 Step 3.5 — adds getReplyForMessageFromD1 for write-path auth reads
 *   (POST outbox duplicate-check; PATCH mark-read message fetch now uses
 *   getInboxMessageFromD1 directly).
 * KV writes are NOT removed here (that is Step 4).
 *
 * These helpers query the inbox_messages table that is being populated by
 * the dual-write scaffolding from Steps 1+2 (PRs #705 + #720).
 *
 * All helpers only read inbound messages (is_reply=0). The reply rows
 * (is_reply=1) are queried separately for inline-reply enrichment.
 *
 * Schema reference: docs/rfc-d1-schema.md — inbox_messages table.
 * Closes the unreadCount drift described in aibtc-mcp-server#497 by
 * computing the count via live SELECT COUNT(*) WHERE read_at IS NULL,
 * replacing the stale cached KV counter.
 *
 * Cache-key invariants: see lib/inbox/CACHE_INVARIANTS.md
 *   (auth'd-branch separation / private no-store / pre-gate cache safety)
 *
 * See: https://github.com/aibtcdev/landing-page/issues/721 (Step 3.1 spec)
 * See: https://github.com/aibtcdev/landing-page/issues/725 (Step 3.2 spec)
 * See: https://github.com/aibtcdev/landing-page/issues/728 (Step 3.3 spec)
 * See: https://github.com/aibtcdev/landing-page/issues/697 (Phase 2.5 umbrella)
 * See: https://github.com/aibtcdev/landing-page/issues/723 (cache-invariant extraction)
 */

import type { InboxMessage, OutboxReply } from "./types";
import { REPLY_D1_PK_PREFIX } from "./d1-pk";
import { getAgentInboxStats } from "./stats";

/**
 * A single row from inbox_messages (is_reply=0) mapped back to the
 * InboxMessage shape used by the route response.
 *
 * Only the fields needed by GET /api/inbox/[address] are selected.
 */
interface D1InboxRow {
  message_id: string;
  from_stx_address: string | null;
  to_btc_address: string;
  to_stx_address: string | null;
  content: string;
  payment_txid: string | null;
  payment_satoshis: number | null;
  payment_status: string | null;
  payment_id: string | null;
  receipt_id: string | null;
  recovered_via_txid: number;
  authenticated: number;
  bitcoin_signature: string | null;
  sender_btc_address: string | null;
  sent_at: string;
  read_at: string | null;
  replied_at: string | null;
  reply_to_message_id: string | null;
}

/**
 * A single reply row (is_reply=1) joined or fetched for inline enrichment.
 */
interface D1ReplyRow {
  reply_to_message_id: string;
  from_btc_address: string | null;
  to_btc_address: string;
  content: string;
  bitcoin_signature: string | null;
  sent_at: string;
}

/** Map a D1 inbound row to the InboxMessage shape. */
function rowToInboxMessage(row: D1InboxRow): InboxMessage {
  return {
    messageId: row.message_id,
    fromAddress: row.from_stx_address ?? "",
    toBtcAddress: row.to_btc_address,
    toStxAddress: row.to_stx_address ?? "",
    content: row.content,
    ...(row.payment_txid != null && { paymentTxid: row.payment_txid }),
    paymentSatoshis: row.payment_satoshis ?? 0,
    sentAt: row.sent_at,
    ...(row.read_at != null && { readAt: row.read_at }),
    ...(row.replied_at != null && { repliedAt: row.replied_at }),
    ...(row.bitcoin_signature != null && { senderSignature: row.bitcoin_signature }),
    ...(row.sender_btc_address != null && { senderBtcAddress: row.sender_btc_address }),
    authenticated: row.authenticated === 1,
    ...(row.recovered_via_txid === 1 && { recoveredViaTxid: true }),
    ...(row.reply_to_message_id != null && { replyTo: row.reply_to_message_id }),
    ...(row.payment_status != null && {
      paymentStatus: row.payment_status as "confirmed" | "pending",
    }),
    ...(row.payment_id != null && { paymentId: row.payment_id }),
    ...(row.receipt_id != null && { receiptId: row.receipt_id }),
  };
}

/** Map a D1 reply row to the OutboxReply shape. */
function replyRowToOutboxReply(row: D1ReplyRow): OutboxReply {
  return {
    messageId: row.reply_to_message_id,
    fromAddress: row.from_btc_address ?? "",
    toBtcAddress: row.to_btc_address,
    reply: row.content,
    signature: row.bitcoin_signature ?? "",
    repliedAt: row.sent_at,
  };
}

export type StatusFilter = "unread" | "read" | "all";

/**
 * Fetch a page of inbound messages for an agent from D1.
 *
 * Mirrors the spec from issue #721:
 *   SELECT … FROM inbox_messages
 *   WHERE to_btc_address = ? AND is_reply = 0
 *   [AND read_at IS NULL | AND read_at IS NOT NULL]
 *   ORDER BY sent_at DESC
 *   LIMIT ? OFFSET ?
 *
 * Returns the raw rows so the caller can map them to response shape.
 */
export async function listInboxMessagesFromD1(
  db: D1Database,
  btcAddress: string,
  limit: number,
  offset: number,
  status: StatusFilter
): Promise<InboxMessage[]> {
  let sql = `
    SELECT
      message_id, from_stx_address, to_btc_address, to_stx_address,
      content, payment_txid, payment_satoshis, payment_status,
      payment_id, receipt_id, recovered_via_txid, authenticated,
      bitcoin_signature, sender_btc_address,
      sent_at, read_at, replied_at, reply_to_message_id
    FROM inbox_messages
    WHERE to_btc_address = ? AND is_reply = 0
  `;

  if (status === "unread") {
    sql += " AND read_at IS NULL";
  } else if (status === "read") {
    sql += " AND read_at IS NOT NULL";
  }

  sql += " ORDER BY sent_at DESC LIMIT ? OFFSET ?";

  const result = await db
    .prepare(sql)
    .bind(btcAddress, limit, offset)
    .all<D1InboxRow>();

  return (result.results ?? []).map(rowToInboxMessage);
}

/**
 * Count inbox rows for a status filter using the same predicates as the list query.
 *
 * Used as a narrow reconciliation fallback when status-filter counters drift from
 * the underlying row set (for example unread counter skew).
 */
export async function countInboxMessagesByStatusFromD1(
  db: D1Database,
  btcAddress: string,
  status: StatusFilter
): Promise<number> {
  let sql = `
    SELECT COUNT(*) AS count
    FROM inbox_messages
    WHERE to_btc_address = ? AND is_reply = 0
  `;

  if (status === "unread") {
    sql += " AND read_at IS NULL";
  } else if (status === "read") {
    sql += " AND read_at IS NOT NULL";
  }

  const row = await db.prepare(sql).bind(btcAddress).first<{ count: number | string }>();
  return Number(row?.count ?? 0);
}

/**
 * Fetch reply rows for a set of parent message IDs.
 *
 * Used to build the inline `replies` map in the list response. Only fetches
 * reply rows whose `reply_to_message_id` is in the provided set, so callers
 * avoid loading replies for messages not in the current page.
 *
 * Returns a Map<parentMessageId, OutboxReply> for O(1) lookup in the route.
 */
export async function fetchRepliesForMessages(
  db: D1Database,
  parentMessageIds: string[]
): Promise<Map<string, OutboxReply>> {
  if (parentMessageIds.length === 0) return new Map();

  // D1 does not support array bindings directly; build positional placeholders.
  const placeholders = parentMessageIds.map(() => "?").join(", ");
  const sql = `
    SELECT
      reply_to_message_id, from_btc_address, to_btc_address,
      content, bitcoin_signature, sent_at
    FROM inbox_messages
    WHERE is_reply = 1
      AND reply_to_message_id IN (${placeholders})
  `;

  const result = await db
    .prepare(sql)
    .bind(...parentMessageIds)
    .all<D1ReplyRow>();

  const map = new Map<string, OutboxReply>();
  for (const row of result.results ?? []) {
    if (row.reply_to_message_id) {
      map.set(row.reply_to_message_id, replyRowToOutboxReply(row));
    }
  }
  return map;
}

/**
 * Fetch a single inbound message by messageId AND btcAddress from D1.
 *
 * The AND clause on to_btc_address is the security gate: it prevents a caller
 * from fetching a message that belongs to a different address (address-match
 * guard — Step 3.2 block-on-merge per issue #725 / secret-mars v167 elevation).
 *
 * SQL shape:
 *   SELECT … FROM inbox_messages
 *   WHERE message_id = ? AND to_btc_address = ? AND is_reply = 0
 *
 * Returns null when:
 *   - message_id does not exist
 *   - message_id exists but to_btc_address does not match (→ 404, not 400/200)
 */
export async function getInboxMessageFromD1(
  db: D1Database,
  btcAddress: string,
  messageId: string
): Promise<InboxMessage | null> {
  const sql = `
    SELECT
      message_id, from_stx_address, to_btc_address, to_stx_address,
      content, payment_txid, payment_satoshis, payment_status,
      payment_id, receipt_id, recovered_via_txid, authenticated,
      bitcoin_signature, sender_btc_address,
      sent_at, read_at, replied_at, reply_to_message_id
    FROM inbox_messages
    WHERE message_id = ? AND to_btc_address = ? AND is_reply = 0
  `;

  const row = await db
    .prepare(sql)
    .bind(messageId, btcAddress)
    .first<D1InboxRow>();

  if (!row) return null;
  return rowToInboxMessage(row);
}

/**
 * Fetch a page of outbox replies sent by an agent from D1.
 *
 * Security gate: SQL WHERE clause filters by `from_btc_address = ?` so replies
 * belonging to a different address are never returned, even if the caller
 * supplies a mismatched URL address.
 *
 * SQL shape (refs #728 Step 3.3 spec):
 *   SELECT … FROM inbox_messages
 *   WHERE is_reply = 1 AND from_btc_address = ?
 *   ORDER BY sent_at DESC
 *   LIMIT ? OFFSET ?
 *
 * Used by GET /api/outbox/[address] and by the sentCount/partners restoration
 * in GET /api/inbox/[address].
 */
export async function listOutboxRepliesFromD1(
  db: D1Database,
  btcAddress: string,
  limit: number,
  offset: number
): Promise<OutboxReply[]> {
  const sql = `
    SELECT
      reply_to_message_id, from_btc_address, to_btc_address,
      content, bitcoin_signature, sent_at
    FROM inbox_messages
    WHERE is_reply = 1 AND from_btc_address = ?
    ORDER BY sent_at DESC
    LIMIT ? OFFSET ?
  `;

  const result = await db
    .prepare(sql)
    .bind(btcAddress, limit, offset)
    .all<D1ReplyRow>();

  return (result.results ?? []).map(replyRowToOutboxReply);
}

// Dead code purge (P3C PR 1): `countOutboxRepliesFromD1` removed.
// Replaced by `getAgentInboxStats(db, btcAddress).sentCount` from
// `lib/inbox/stats.ts` which serves O(1) point-lookups against the
// maintained `agent_inbox_stats` table (migration 012). The prior
// `SELECT COUNT(*) FROM inbox_messages WHERE is_reply = 1 AND
// from_btc_address = ?` was the textbook D1 COUNT(*) anti-pattern
// (cf. `feedback_d1_count_antipattern`).

/**
 * Fetch a single reply for a parent message, filtered by the replier's BTC address.
 *
 * Phase 2.5 Step 3.5 — used by POST /api/outbox/[address] to check for
 * duplicate replies before storing a new one.
 *
 * The `from_btc_address` predicate is the tenant-discriminator gate: it ensures
 * only a prior reply by THIS agent (identified via Bitcoin signature) blocks the
 * duplicate check. A reply by a different agent to the same parent does not
 * trigger a false-409.
 *
 * SQL shape:
 *   SELECT reply_to_message_id, from_btc_address, to_btc_address,
 *          content, bitcoin_signature, sent_at
 *   FROM inbox_messages
 *   WHERE reply_to_message_id = ? AND from_btc_address = ? AND is_reply = 1
 *   LIMIT 1
 *
 * Returns null when:
 *   - No reply exists for the given parentMessageId
 *   - A reply exists but was sent by a different agent (from_btc_address mismatch)
 *
 * See: https://github.com/aibtcdev/landing-page/issues/736 (Step 3.5 spec)
 */
export async function getReplyForMessageFromD1(
  db: D1Database,
  parentMessageId: string,
  fromBtcAddress: string
): Promise<OutboxReply | null> {
  const sql = `
    SELECT
      reply_to_message_id, from_btc_address, to_btc_address,
      content, bitcoin_signature, sent_at
    FROM inbox_messages
    WHERE reply_to_message_id = ? AND from_btc_address = ? AND is_reply = 1
    LIMIT 1
  `;

  const row = await db
    .prepare(sql)
    .bind(parentMessageId, fromBtcAddress)
    .first<D1ReplyRow>();

  if (!row) return null;
  return replyRowToOutboxReply(row);
}

/**
 * Check whether a payment txid has already been redeemed (double-redemption guard).
 *
 * Phase 2.5 Step 4 — replaces the KV `inbox:redeemed-txid:{txid}` read in the
 * txid-recovery path. The D1 unique partial index `idx_inbox_payment_txid` on
 * `payment_txid WHERE payment_txid IS NOT NULL` makes this query index-only.
 *
 * Returns the messageId of the existing row on redemption, or null if the txid
 * has not been used. Callers return 409 on a non-null result.
 *
 * SQL shape:
 *   SELECT message_id FROM inbox_messages
 *   WHERE payment_txid = ? AND payment_txid IS NOT NULL
 *   LIMIT 1
 */
export async function checkRedeemedTxidInD1(
  db: D1Database,
  paymentTxid: string
): Promise<string | null> {
  const sql = `
    SELECT message_id
    FROM inbox_messages
    WHERE payment_txid = ? AND payment_txid IS NOT NULL
    LIMIT 1
  `;

  const row = await db
    .prepare(sql)
    .bind(paymentTxid)
    .first<{ message_id: string }>();

  return row?.message_id ?? null;
}

// Re-export the prefix so tests can verify synthesized IDs
export { REPLY_D1_PK_PREFIX };

// ---------------------------------------------------------------------------
// Agent-enrichment helpers (replaces getAgentInbox + getSentIndex KV reads)
// ---------------------------------------------------------------------------

/**
 * Fetch per-agent inbox summary from D1 for use in agent-enrichment.ts.
 *
 * Phase 2.5 #746 — replaces `getAgentInbox(kv, btcAddress)` which reads the
 * stale KV `inbox:agent:{btcAddress}` index (frozen at Step 4 merge, 14:24Z
 * 2026-05-11). Returns a live count directly from inbox_messages via
 * SELECT COUNT(*)s that hit the existing partial index
 * `idx_inbox_unread` (WHERE read_at IS NULL).
 *
 * Returns null when `db` is undefined (binding not available) or on D1 error.
 * Callers treat null identically to a KV miss — fail-open, matching the
 * heartbeat `fetchUnreadCount` pattern from #745.
 *
 * Return shape is compatible with the InboxAgentIndex fields read by
 * agent-enrichment.ts:
 *   inboxIndex?.unreadCount  → unreadCount
 *   !!inboxIndex             → hasInboxMessages (totalCount > 0)
 *
 * SQL:
 *   SELECT
 *     COUNT(*) AS total_count,
 *     COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
 *     MAX(sent_at) AS last_message_at
 *   FROM inbox_messages
 *   WHERE to_btc_address = ? AND is_reply = 0
 */
export interface AgentInboxSummary {
  totalCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
}

export async function getAgentInboxFromD1(
  db: D1Database | undefined,
  btcAddress: string
): Promise<AgentInboxSummary | null> {
  // P3 structural read flip: replaced live COUNT(*) / COUNT(CASE WHEN) aggregate
  // with O(1) point-lookup from agent_inbox_stats. Function signature unchanged
  // so all callers (agent-enrichment.ts) require no updates.
  if (!db) return null;
  try {
    const stats = await getAgentInboxStats(db, btcAddress);
    // A zero received count means no messages — return null so callers
    // treat this agent as having no inbox (same as a KV miss).
    if (stats.receivedCount === 0) return null;
    return {
      totalCount: stats.receivedCount,
      unreadCount: stats.unreadCount,
      lastMessageAt: stats.lastMessageAt,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch per-agent sent-message summary from D1 for use in agent-enrichment.ts.
 *
 * Phase 2.5 #746 — replaces `getSentIndex(kv, btcAddress)` which reads the
 * stale KV `inbox:sent:{btcAddress}` index. Returns a live count from
 * inbox_messages WHERE is_reply=1 AND from_btc_address=?.
 *
 * Returns null when `db` is undefined or on D1 error (fail-open).
 *
 * Return shape is compatible with the SentMessageIndex field read by
 * agent-enrichment.ts:
 *   sentIndex?.messageIds.length → sentCount
 *
 * SQL:
 *   SELECT COUNT(*) AS sent_count, MAX(sent_at) AS last_sent_at
 *   FROM inbox_messages
 *   WHERE is_reply = 1 AND from_btc_address = ?
 */
export interface AgentSentSummary {
  sentCount: number;
  lastSentAt: string | null;
}

export async function getSentIndexFromD1(
  db: D1Database | undefined,
  btcAddress: string
): Promise<AgentSentSummary | null> {
  // P3 structural read flip: replaced live COUNT(*) aggregate with O(1)
  // point-lookup from agent_inbox_stats. Function signature unchanged.
  if (!db) return null;
  try {
    const stats = await getAgentInboxStats(db, btcAddress);
    return {
      sentCount: stats.sentCount,
      lastSentAt: stats.lastSentAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Activity feed helpers (replaces inbox:agent:* / inbox:message:* KV reads)
// ---------------------------------------------------------------------------

/**
 * Fetch the N most recent inbound messages for an agent from D1.
 *
 * Phase 2.5 #746 — replaces the two-step KV pattern in lib/activity.ts:
 *   1. kv.get(`inbox:agent:${btcAddress}`)  → get messageIds array
 *   2. kv.get(`inbox:message:${id}`)        → fetch each message
 *
 * This consolidates into a single SELECT … ORDER BY sent_at DESC LIMIT ?.
 * The SQL path hits the `idx_inbox_to_btc_sent_at` partial index
 * (on `inbox_messages(to_btc_address, sent_at DESC) WHERE is_reply = 0`).
 *
 * Returns empty array when `db` is undefined, no messages exist, or on D1
 * error (fail-open — activity feed gracefully degrades to no events).
 *
 * SQL:
 *   SELECT … FROM inbox_messages
 *   WHERE to_btc_address = ? AND is_reply = 0
 *   ORDER BY sent_at DESC
 *   LIMIT ?
 */
export async function getRecentInboxEventsFromD1(
  db: D1Database | undefined,
  btcAddress: string,
  limit: number
): Promise<InboxMessage[]> {
  if (!db) return [];
  try {
    const sql = `
      SELECT
        message_id, from_stx_address, to_btc_address, to_stx_address,
        content, payment_txid, payment_satoshis, payment_status,
        payment_id, receipt_id, recovered_via_txid, authenticated,
        bitcoin_signature, sender_btc_address,
        sent_at, read_at, replied_at, reply_to_message_id
      FROM inbox_messages
      WHERE to_btc_address = ? AND is_reply = 0
      ORDER BY sent_at DESC
      LIMIT ?
    `;
    const result = await db
      .prepare(sql)
      .bind(btcAddress, limit)
      .all<D1InboxRow>();
    return (result.results ?? []).map(rowToInboxMessage);
  } catch {
    return [];
  }
}
