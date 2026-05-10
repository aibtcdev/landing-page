/**
 * D1 read helpers for GET /api/inbox/[address].
 *
 * Phase 2.5 Step 3.1 — flip inbox-list GET from KV reads to D1 SELECTs.
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
 * Cache-key invariants (from #697 umbrella, non-negotiable):
 *   1. Auth'd vs public branch separation — no auth'd branch exists on this
 *      endpoint yet (the GET is fully public). When an auth'd branch is added
 *      in a future PR, its cache key MUST include a verified-address-hash suffix
 *      OR be excluded from any shared cache. This file documents that invariant
 *      so the constraint survives future diffs.
 *   2. Auth'd branch responses MUST set Cache-Control: private, no-store.
 *      The current (public-only) path does not set this header; adding an
 *      auth'd branch without adding this header would violate invariant 2.
 *   3. Pre-gate cache safety — never serve a cache HIT before the auth gate runs.
 *      Not currently at risk (no auth gate on this GET), but a follow-up PR
 *      adding auth MUST gate any cache lookup behind signature verification to
 *      avoid the agent-news#802 unauthenticated-HIT bug class.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/721
 * See: https://github.com/aibtcdev/landing-page/issues/697
 */

import type { InboxMessage, OutboxReply } from "./types";
import { REPLY_D1_PK_PREFIX } from "./d1-pk";

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
  message_id: string;
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
 * Count inbound messages for an agent, optionally filtered to unread.
 *
 * This is the live SELECT COUNT(*) that replaces the stale KV cached counter
 * and closes aibtc-mcp-server#497.
 */
export async function countInboxMessagesFromD1(
  db: D1Database,
  btcAddress: string,
  status: StatusFilter
): Promise<number> {
  let sql = `
    SELECT COUNT(*) AS cnt
    FROM inbox_messages
    WHERE to_btc_address = ? AND is_reply = 0
  `;

  if (status === "unread") {
    sql += " AND read_at IS NULL";
  } else if (status === "read") {
    sql += " AND read_at IS NOT NULL";
  }

  const row = await db
    .prepare(sql)
    .bind(btcAddress)
    .first<{ cnt: number }>();

  return row?.cnt ?? 0;
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
      message_id, reply_to_message_id, from_btc_address, to_btc_address,
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

// Re-export the prefix so tests can verify synthesized IDs
export { REPLY_D1_PK_PREFIX };
