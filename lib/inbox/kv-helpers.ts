/**
 * KV helper functions for the Inbox System.
 *
 * Inbox messages, replies, and per-agent indices live in D1 (#745/#746). KV
 * only holds staged x402 payments awaiting settlement.
 */

import { KV_PREFIXES, STAGED_PAYMENT_TTL_SECONDS } from "./constants";
import type { InboxMessage, StagedInboxMessage } from "./types";
import { insertInboundMessageToD1, isPaymentTxidUniqueViolation } from "./d1-dual-write";
import { getInboxMessageFromD1 } from "./d1-reads";
import { bumpInboundStats } from "./stats";
import { createNoopLogger, type Logger } from "@/lib/logging";

function buildStagedPaymentKey(paymentId: string): string {
  return `${KV_PREFIXES.STAGED_PAYMENT}${paymentId}`;
}

export async function getStagedInboxPayment(
  kv: KVNamespace,
  paymentId: string,
  logger: Logger = createNoopLogger()
): Promise<StagedInboxMessage | null> {
  const data = await kv.get(buildStagedPaymentKey(paymentId));
  if (!data) return null;

  try {
    return JSON.parse(data) as StagedInboxMessage;
  } catch (e) {
    logger.error("Failed to parse staged inbox payment", { paymentId, error: String(e) });
    return null;
  }
}

export async function storeStagedInboxPayment(
  kv: KVNamespace,
  staged: StagedInboxMessage
): Promise<void> {
  await kv.put(buildStagedPaymentKey(staged.paymentId), JSON.stringify(staged), {
    expirationTtl: STAGED_PAYMENT_TTL_SECONDS,
  });
}

export async function deleteStagedInboxPayment(
  kv: KVNamespace,
  paymentId: string
): Promise<void> {
  await kv.delete(buildStagedPaymentKey(paymentId));
}

/**
 * Finalize a pending x402 staged inbox payment by writing the confirmed message
 * to D1 and clearing the staged KV record.
 *
 * Closes the post-#745 legacy-KV leak (#760): the synchronous-confirmed branch
 * of `POST /api/inbox/[address]` already routes through D1, but the pending →
 * confirmed transition used to call legacy KV writers (`storeMessage`,
 * `updateAgentInbox`, `updateSentIndex`), bypassing D1.
 *
 * Idempotency:
 *  - If D1 already has the row (queue retry, parallel poll), skip the INSERT
 *    and return the existing row.
 *  - If the INSERT races and hits the `idx_inbox_payment_txid` UNIQUE
 *    partial index, re-query D1 for the canonical row and return it. This
 *    mirrors the synchronous-confirmed branch's `resolvePaymentTxidConflict`
 *    behavior — a 409-equivalent outcome that the queue should treat as
 *    success.
 *  - The staged KV record is deleted on every success path.
 *
 * @returns the finalized message, or null when:
 *   - the staged KV record has already been cleared (nothing to finalize), or
 *   - the UNIQUE-violation re-query unexpectedly returned no row (treated as
 *     permanent outcome — the queue should still ack and move on).
 */
export async function finalizeStagedInboxPayment(
  kv: KVNamespace,
  db: D1Database,
  paymentId: string,
  updates: Partial<InboxMessage> = {}
): Promise<InboxMessage | null> {
  const staged = await getStagedInboxPayment(kv, paymentId);
  if (!staged) return null;

  const existingMessage = await getInboxMessageFromD1(
    db,
    staged.message.toBtcAddress,
    staged.message.messageId
  );
  if (existingMessage) {
    await deleteStagedInboxPayment(kv, paymentId);
    return existingMessage;
  }

  const finalizedMessage: InboxMessage = {
    ...staged.message,
    ...updates,
    paymentStatus: "confirmed",
    paymentId,
  };

  let insertResult: { changes: number };
  try {
    insertResult = await insertInboundMessageToD1(db, finalizedMessage);
  } catch (err) {
    if (isPaymentTxidUniqueViolation(err)) {
      // A parallel finalize already inserted the row under the same payment_txid.
      // Re-query D1 for the canonical row, clear the staged record, and return it.
      // No stats bump here — the finalize that won the race owns the increment.
      const canonical = await getInboxMessageFromD1(
        db,
        staged.message.toBtcAddress,
        staged.message.messageId
      );
      await deleteStagedInboxPayment(kv, paymentId);
      return canonical;
    }
    throw err;
  }

  // Bump received_count/unread_count for the staged → confirmed delivery.
  // Pending payments return 202 from POST /api/inbox/[address] WITHOUT inserting
  // the row, so the synchronous bump on that path never runs for them — the row
  // is first written here, when the confirmed payment finalizes. Omitting this
  // is the systematic source of agent_inbox_stats received-count drift (#945):
  // every pending→confirmed message landed in inbox_messages but was never
  // counted. Bump only on a real insert (changes === 1) — a parallel finalize
  // that lost the ON CONFLICT race returns 0 and must not double-count. Best-
  // effort to mirror the synchronous delivery path; any residual drift stays
  // reconcilable via /api/admin/reconcile?target=inbox_stats.
  if (insertResult.changes === 1) {
    await bumpInboundStats(
      db,
      finalizedMessage.toBtcAddress,
      finalizedMessage.sentAt
    ).catch(() => {});
  }

  await deleteStagedInboxPayment(kv, paymentId);
  return finalizedMessage;
}
