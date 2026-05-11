/**
 * D1 dual-write helpers for inbox_messages table.
 *
 * Phase 2.5 Step 1 — reversible scaffolding.
 * These helpers INSERT alongside existing KV writes; they do NOT replace them.
 * Reads still come from KV. The cutover (read flip + write removal) is Steps 3+4.
 *
 * Failure contract: callers wrap these in ctx.waitUntil(...).catch(logger.error)
 * so a D1 INSERT failure is logged-and-swallowed and never blocks the response.
 *
 * Field mapping verified against real KV records sampled 2026-05-09:
 *   inbox:message:msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf
 *   inbox:reply:msg_1771381860132_537377a5-2550-4753-a11f-841e9ddecd90
 *
 * InboxMessage fields: messageId, fromAddress (STX payer), toBtcAddress, toStxAddress,
 *   content, paymentTxid?, paymentSatoshis, sentAt, authenticated, recoveredViaTxid?,
 *   senderBtcAddress?, senderSignature?, replyTo?, paymentStatus?, paymentId?, receiptId?
 *
 * OutboxReply fields: messageId (parent), fromAddress (replier BTC), toBtcAddress
 *   (sender STX — may need resolution to BTC via kv stx: key), reply, signature, repliedAt
 *
 * Note on OutboxReply.toBtcAddress: the field name is "toBtcAddress" but the value
 * can be a Stacks address (SP...). Always call resolveReplyRecipientBtcAddress before
 * persisting. See Phase 1.4 post-mortem (#680/#681/#682).
 *
 * See: https://github.com/aibtcdev/landing-page/issues/697
 */

import type { InboxMessage, OutboxReply } from "./types";
import { deriveReplyD1Id } from "./d1-pk";
import { isStxAddress } from "@/lib/validation/address";
import type { AgentRecord } from "@/lib/types";

/**
 * Detect the SQLite UNIQUE-constraint violation on the inbox_messages
 * payment_txid partial index (idx_inbox_payment_txid).
 *
 * @cloudflare/workers-types does not surface SQLite constraint codes — only
 * the wrapped message string. We match the full constraint string verbatim
 * (per Copilot review on #756) to avoid false positives if future schema
 * changes introduce other tables/columns whose names contain `payment_txid`.
 *
 * Re-check periodically against `@cloudflare/workers-types` releases — when
 * D1 introduces structured error codes, switch to those.
 */
export function isPaymentTxidUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("UNIQUE constraint failed: inbox_messages.payment_txid");
}

/**
 * Resolve the reply recipient's BTC address.
 *
 * OutboxReply.toBtcAddress can be a Stacks address (pre-resolution) because the
 * outbox route stores message.fromAddress (which is a STX address for inbound messages)
 * directly into the toBtcAddress field. If the value is already a BTC address, return it
 * directly. If it's a Stacks address, look up the agent record from KV.
 *
 * Returns null if the STX address cannot be resolved — caller should skip the D1 INSERT.
 */
export async function resolveReplyRecipientBtcAddress(
  kv: KVNamespace,
  candidateAddress: string
): Promise<string | null> {
  if (!isStxAddress(candidateAddress)) return candidateAddress;

  const stxRecordRaw = await kv.get(`stx:${candidateAddress}`);
  if (!stxRecordRaw) return null;

  try {
    const parsed = JSON.parse(stxRecordRaw) as Partial<AgentRecord>;
    return typeof parsed.btcAddress === "string" ? parsed.btcAddress : null;
  } catch {
    return null;
  }
}

/**
 * INSERT an inbound inbox message (is_reply=0) into D1.
 *
 * Column mapping (verified against migrations/003_inbox_messages.sql):
 *   message_id          <- message.messageId
 *   is_reply            <- 0 (inbound)
 *   reply_to_message_id <- message.replyTo ?? NULL (threading, not FK-enforced at dual-write time)
 *   from_stx_address    <- message.fromAddress (x402 payer's STX address)
 *   from_btc_address    <- NULL (inbound: sender identified by STX, not BTC)
 *   to_btc_address      <- message.toBtcAddress
 *   to_stx_address      <- message.toStxAddress
 *   content             <- message.content
 *   payment_txid        <- message.paymentTxid ?? NULL
 *   payment_satoshis    <- message.paymentSatoshis ?? NULL
 *   payment_status      <- message.paymentStatus ?? NULL
 *   payment_terminal_reason <- NULL (set later by reconciliation worker)
 *   payment_error_code  <- NULL (set later by reconciliation worker)
 *   payment_replacement_txid <- NULL
 *   payment_id          <- message.paymentId ?? NULL
 *   receipt_id          <- message.receiptId ?? NULL
 *   recovered_via_txid  <- message.recoveredViaTxid ? 1 : 0
 *   authenticated       <- message.authenticated ? 1 : 0
 *   bitcoin_signature   <- message.senderSignature ?? NULL
 *   sender_btc_address  <- message.senderBtcAddress ?? NULL
 *   sent_at             <- message.sentAt
 *   read_at             <- NULL (message just delivered)
 *   replied_at          <- NULL (no reply yet)
 */
export async function insertInboundMessageToD1(
  db: D1Database,
  message: InboxMessage
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inbox_messages (
        message_id, is_reply, reply_to_message_id,
        from_stx_address, from_btc_address,
        to_btc_address, to_stx_address,
        content, payment_txid, payment_satoshis,
        payment_status, payment_terminal_reason,
        payment_error_code, payment_replacement_txid,
        payment_id, receipt_id,
        recovered_via_txid, authenticated,
        bitcoin_signature, sender_btc_address,
        sent_at, read_at, replied_at
      ) VALUES (
        ?, 0, ?,
        ?, NULL,
        ?, ?,
        ?, ?, ?,
        ?, NULL, NULL, NULL,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, NULL, NULL
      ) ON CONFLICT(message_id) DO NOTHING`
    )
    .bind(
      message.messageId,
      message.replyTo ?? null,
      // from_stx_address = fromAddress (x402 payer's STX address)
      message.fromAddress,
      message.toBtcAddress,
      message.toStxAddress ?? null,
      message.content,
      message.paymentTxid ?? null,
      message.paymentSatoshis ?? null,
      message.paymentStatus ?? null,
      message.paymentId ?? null,
      message.receiptId ?? null,
      // recovered_via_txid: 0 = false, 1 = true
      message.recoveredViaTxid ? 1 : 0,
      message.authenticated ? 1 : 0,
      message.senderSignature ?? null,
      message.senderBtcAddress ?? null,
      message.sentAt
    )
    .run();
}

/**
 * UPDATE read_at and/or replied_at on an existing D1 inbox_messages row.
 *
 * Called from the mark-read PATCH and the outbox-reply POST to keep D1 in
 * sync with KV state updates. Builds a dynamic SET clause so callers only
 * pass the fields they actually changed.
 *
 * Safety contract:
 *  - Noop when updates is empty (no fields → no SQL executed).
 *  - Caller is expressing "set this to this value now"; we do NOT coalesce
 *    here — the caller already checked KV state before deciding what to send.
 *  - If the D1 row doesn't exist (orphan-recipient messages), the UPDATE
 *    simply affects 0 rows; no error is raised.
 *  - Callers wrap this in ctx.waitUntil(...).catch(logger.error) so a D1
 *    failure is logged-and-swallowed and never blocks the response.
 */
export async function updateMessageStateD1(
  db: D1Database,
  messageId: string,
  updates: { readAt?: string; repliedAt?: string }
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (updates.readAt !== undefined) {
    setClauses.push("read_at = ?");
    values.push(updates.readAt);
  }
  if (updates.repliedAt !== undefined) {
    setClauses.push("replied_at = ?");
    values.push(updates.repliedAt);
  }
  if (setClauses.length === 0) return; // noop guard — nothing to update
  values.push(messageId);
  await db
    .prepare(
      `UPDATE inbox_messages SET ${setClauses.join(", ")} WHERE message_id = ?`
    )
    .bind(...(values as Parameters<D1PreparedStatement["bind"]>))
    .run();
}

/**
 * INSERT a reply (is_reply=1) into D1.
 *
 * Column mapping (verified against migrations/003_inbox_messages.sql):
 *   message_id          <- deriveReplyD1Id(reply.messageId) (synthesized PK, avoids collision with inbound)
 *   is_reply            <- 1 (reply)
 *   reply_to_message_id <- reply.messageId (FK to parent inbound row)
 *   from_stx_address    <- NULL (reply: sender identified by BTC, not STX)
 *   from_btc_address    <- reply.fromAddress (replier's BTC address)
 *   to_btc_address      <- resolvedToBtcAddress (resolved from reply.toBtcAddress — may be STX)
 *   to_stx_address      <- NULL (replies route by BTC)
 *   content             <- reply.reply
 *   payment_txid        <- NULL (replies are free)
 *   payment_satoshis    <- NULL (replies are free)
 *   payment_status      <- NULL (no payment)
 *   payment_terminal_reason <- NULL
 *   payment_error_code  <- NULL
 *   payment_replacement_txid <- NULL
 *   payment_id          <- NULL
 *   receipt_id          <- NULL
 *   recovered_via_txid  <- 0
 *   authenticated       <- 0 (BIP-322 signature stored in bitcoin_signature)
 *   bitcoin_signature   <- reply.signature
 *   sender_btc_address  <- NULL (for replies, from_btc_address is the signer)
 *   sent_at             <- reply.repliedAt
 *   read_at             <- NULL
 *   replied_at          <- NULL
 */
export async function insertReplyToD1(
  db: D1Database,
  kv: KVNamespace,
  reply: OutboxReply
): Promise<void> {
  const resolvedToBtcAddress = await resolveReplyRecipientBtcAddress(kv, reply.toBtcAddress);
  if (!resolvedToBtcAddress) {
    throw new Error(
      `Unable to resolve reply recipient BTC address from "${reply.toBtcAddress}" for messageId "${reply.messageId}"`
    );
  }

  const replyMessageId = deriveReplyD1Id(reply.messageId);

  await db
    .prepare(
      `INSERT INTO inbox_messages (
        message_id, is_reply, reply_to_message_id,
        from_stx_address, from_btc_address,
        to_btc_address, to_stx_address,
        content, payment_txid, payment_satoshis,
        payment_status, payment_terminal_reason,
        payment_error_code, payment_replacement_txid,
        payment_id, receipt_id,
        recovered_via_txid, authenticated,
        bitcoin_signature, sender_btc_address,
        sent_at, read_at, replied_at
      ) VALUES (
        ?, 1, ?,
        NULL, ?,
        ?, NULL,
        ?, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, NULL,
        0, 0,
        ?, NULL,
        ?, NULL, NULL
      ) ON CONFLICT(message_id) DO NOTHING`
    )
    .bind(
      replyMessageId,
      // reply_to_message_id = parent inbound message ID
      reply.messageId,
      // from_btc_address = replier's BTC address
      reply.fromAddress,
      resolvedToBtcAddress,
      // content = reply text
      reply.reply,
      // bitcoin_signature = BIP-322 signature
      reply.signature,
      reply.repliedAt
    )
    .run();
}
