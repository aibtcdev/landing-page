/**
 * KV helper functions for the Inbox System.
 *
 * Provides storage and retrieval operations for inbox messages, replies,
 * and agent inbox indices.
 */

import { KV_PREFIXES, STAGED_PAYMENT_TTL_SECONDS } from "./constants";
import type {
  InboxMessage,
  OutboxReply,
  InboxAgentIndex,
  SentMessageIndex,
  StagedInboxMessage,
} from "./types";
import { insertInboundMessageToD1, isPaymentTxidUniqueViolation } from "./d1-dual-write";
import { getInboxMessageFromD1 } from "./d1-reads";
import { bumpInboundStats } from "./stats";

/**
 * Build KV key for an individual inbox message.
 *
 * @param messageId - Message ID
 * @returns KV key: "inbox:message:{messageId}"
 */
function buildMessageKey(messageId: string): string {
  return `${KV_PREFIXES.MESSAGE}${messageId}`;
}

/**
 * Build KV key for an outbox reply.
 *
 * @param messageId - Message ID
 * @returns KV key: "inbox:reply:{messageId}"
 */
function buildReplyKey(messageId: string): string {
  return `${KV_PREFIXES.REPLY}${messageId}`;
}

/**
 * Build KV key for agent inbox index.
 *
 * @param btcAddress - Bitcoin address
 * @returns KV key: "inbox:agent:{btcAddress}"
 */
function buildAgentIndexKey(btcAddress: string): string {
  return `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;
}

/**
 * Build KV key for agent sent message index.
 *
 * @param btcAddress - Bitcoin address
 * @returns KV key: "inbox:sent:{btcAddress}"
 */
function buildSentIndexKey(btcAddress: string): string {
  return `${KV_PREFIXES.SENT_INDEX}${btcAddress}`;
}

function buildStagedPaymentKey(paymentId: string): string {
  return `${KV_PREFIXES.STAGED_PAYMENT}${paymentId}`;
}

/**
 * Get an inbox message by ID.
 *
 * @param kv - Cloudflare KV namespace
 * @param messageId - Message ID
 * @returns InboxMessage or null if not found
 */
export async function getMessage(
  kv: KVNamespace,
  messageId: string
): Promise<InboxMessage | null> {
  const key = buildMessageKey(messageId);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as InboxMessage;
  } catch (e) {
    console.error(`Failed to parse inbox message ${key}:`, e);
    return null;
  }
}

/**
 * Store an inbox message.
 *
 * @param kv - Cloudflare KV namespace
 * @param message - InboxMessage to store
 *
 * @example
 * await storeMessage(kv, {
 *   messageId: "msg_123",
 *   fromAddress: "SP...",
 *   toBtcAddress: "bc1q...",
 *   toStxAddress: "SP...",
 *   content: "Hello!",
 *   paymentTxid: "abc...",
 *   paymentSatoshis: 100,
 *   sentAt: new Date().toISOString(),
 * });
 */
export async function storeMessage(
  kv: KVNamespace,
  message: InboxMessage
): Promise<void> {
  const key = buildMessageKey(message.messageId);
  await kv.put(key, JSON.stringify(message));
}

/**
 * Update an inbox message with partial updates.
 *
 * @param kv - Cloudflare KV namespace
 * @param messageId - Message ID
 * @param updates - Partial InboxMessage fields to update
 * @returns Updated InboxMessage or null if message not found
 *
 * @example
 * const updated = await updateMessage(kv, "msg_123", {
 *   readAt: new Date().toISOString(),
 * });
 */
export async function updateMessage(
  kv: KVNamespace,
  messageId: string,
  updates: Partial<InboxMessage>
): Promise<InboxMessage | null> {
  const existing = await getMessage(kv, messageId);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  await storeMessage(kv, updated);
  return updated;
}

/**
 * Get an outbox reply by message ID.
 *
 * @param kv - Cloudflare KV namespace
 * @param messageId - Message ID
 * @returns OutboxReply or null if not found
 */
export async function getReply(
  kv: KVNamespace,
  messageId: string
): Promise<OutboxReply | null> {
  const key = buildReplyKey(messageId);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as OutboxReply;
  } catch (e) {
    console.error(`Failed to parse outbox reply ${key}:`, e);
    return null;
  }
}

/**
 * Store an outbox reply.
 *
 * @param kv - Cloudflare KV namespace
 * @param reply - OutboxReply to store
 *
 * @example
 * await storeReply(kv, {
 *   messageId: "msg_123",
 *   fromAddress: "bc1q...",
 *   toBtcAddress: "bc1q...",
 *   reply: "Thanks for the message!",
 *   signature: "...",
 *   repliedAt: new Date().toISOString(),
 * });
 */
export async function storeReply(
  kv: KVNamespace,
  reply: OutboxReply
): Promise<void> {
  const key = buildReplyKey(reply.messageId);
  await kv.put(key, JSON.stringify(reply));
}

/**
 * Get the agent inbox index.
 *
 * @deprecated reads stale data after #730 Step 4 — use lib/inbox/d1-reads.ts equivalents.
 *   KV writes for `inbox:agent:{btcAddress}` stopped at 2026-05-11T14:24Z (PR #745).
 *   Newly delivered messages are not reflected. Use `getAgentInboxFromD1` instead.
 *   Callers migrated in #746.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @returns InboxAgentIndex or null if not found
 *
 * @example
 * const inbox = await getAgentInbox(kv, "bc1q...");
 * if (inbox) {
 *   console.log(`Unread count: ${inbox.unreadCount}`);
 * }
 */
export async function getAgentInbox(
  kv: KVNamespace,
  btcAddress: string
): Promise<InboxAgentIndex | null> {
  const key = buildAgentIndexKey(btcAddress);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as InboxAgentIndex;
  } catch (e) {
    console.error(`Failed to parse inbox agent index ${key}:`, e);
    return null;
  }
}

/**
 * Update the agent inbox index by adding a new message.
 *
 * Creates the index if it doesn't exist, or appends to the existing index.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param messageId - Message ID to add
 * @param timestamp - ISO timestamp for lastMessageAt
 *
 * @example
 * await updateAgentInbox(kv, "bc1q...", "msg_123", new Date().toISOString());
 */
export async function updateAgentInbox(
  kv: KVNamespace,
  btcAddress: string,
  messageId: string,
  timestamp: string
): Promise<void> {
  const key = buildAgentIndexKey(btcAddress);
  const existing = await getAgentInbox(kv, btcAddress);

  let index: InboxAgentIndex;
  if (existing) {
    // Add message ID if not already present
    if (!existing.messageIds.includes(messageId)) {
      existing.messageIds.push(messageId);
      existing.unreadCount += 1; // New message is unread by default
    }
    existing.lastMessageAt = timestamp;
    index = existing;
  } else {
    // Create new index
    index = {
      btcAddress,
      messageIds: [messageId],
      unreadCount: 1,
      lastMessageAt: timestamp,
    };
  }

  await kv.put(key, JSON.stringify(index));
}

/**
 * Get the agent sent message index.
 *
 * @deprecated reads stale data after #730 Step 4 — use lib/inbox/d1-reads.ts equivalents.
 *   KV writes for `inbox:sent:{btcAddress}` stopped at 2026-05-11T14:24Z (PR #745).
 *   Newly delivered replies are not reflected. Use `getSentIndexFromD1` instead.
 *   Callers migrated in #746.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @returns SentMessageIndex or null if not found
 */
export async function getSentIndex(
  kv: KVNamespace,
  btcAddress: string
): Promise<SentMessageIndex | null> {
  const key = buildSentIndexKey(btcAddress);
  const data = await kv.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as SentMessageIndex;
  } catch (e) {
    console.error(`Failed to parse sent index ${key}:`, e);
    return null;
  }
}

/**
 * Update the agent sent message index by adding a new message.
 *
 * Creates the index if it doesn't exist, or appends to the existing index.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Sender's Bitcoin address
 * @param messageId - Message ID to add
 * @param timestamp - ISO timestamp for lastSentAt
 */
export async function updateSentIndex(
  kv: KVNamespace,
  btcAddress: string,
  messageId: string,
  timestamp: string
): Promise<void> {
  const key = buildSentIndexKey(btcAddress);
  const existing = await getSentIndex(kv, btcAddress);

  let index: SentMessageIndex;
  if (existing) {
    if (!existing.messageIds.includes(messageId)) {
      existing.messageIds.push(messageId);
    }
    existing.lastSentAt = timestamp;
    index = existing;
  } else {
    index = {
      btcAddress,
      messageIds: [messageId],
      lastSentAt: timestamp,
    };
  }

  await kv.put(key, JSON.stringify(index));
}

export async function getStagedInboxPayment(
  kv: KVNamespace,
  paymentId: string
): Promise<StagedInboxMessage | null> {
  const data = await kv.get(buildStagedPaymentKey(paymentId));
  if (!data) return null;

  try {
    return JSON.parse(data) as StagedInboxMessage;
  } catch (e) {
    console.error(`Failed to parse staged inbox payment ${paymentId}:`, e);
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

/**
 * Decrement the unread count for an agent's inbox.
 *
 * This is the canonical way to decrement unreadCount when marking a message
 * as read (either explicitly via PATCH or implicitly via reply). It prevents
 * the count from going negative.
 *
 * NOTE: Known race condition — this is a read-modify-write without CAS.
 * Concurrent calls (e.g. batch replies) can lose decrements. KV does not
 * support atomic compare-and-swap. Acceptable for now; if drift becomes
 * noticeable, add a periodic reconciliation that recomputes unreadCount
 * from actual read/unread message state, or serialize via Durable Objects.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 *
 * @example
 * await decrementUnreadCount(kv, "bc1q...");
 */
export async function decrementUnreadCount(
  kv: KVNamespace,
  btcAddress: string
): Promise<void> {
  const key = buildAgentIndexKey(btcAddress);
  const index = await getAgentInbox(kv, btcAddress);
  if (index && index.unreadCount > 0) {
    index.unreadCount -= 1;
    await kv.put(key, JSON.stringify(index));
  }
}
