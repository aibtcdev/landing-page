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
 * @deprecated reads stale data after #730 Step 4 — KV inbox writes were
 *   removed in PR #745, so this returns frozen-at-cutover data for newly
 *   delivered messages. Migrate callers to lib/inbox/d1-reads.ts equivalents
 *   (`listInboxMessagesFromD1` / `countInboxMessagesFromD1`). Tracked in #746.
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
 * @deprecated reads stale data after #730 Step 4 — KV sent-index writes were
 *   removed in PR #745, so this returns frozen-at-cutover data for newly
 *   sent messages. Migrate callers to lib/inbox/d1-reads.ts equivalents
 *   (`listOutboxRepliesFromD1` / `countOutboxRepliesFromD1`). Tracked in #746.
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

export async function finalizeStagedInboxPayment(
  kv: KVNamespace,
  paymentId: string,
  updates: Partial<InboxMessage> = {}
): Promise<InboxMessage | null> {
  const staged = await getStagedInboxPayment(kv, paymentId);
  if (!staged) return null;

  const existingMessage = await getMessage(kv, staged.message.messageId);
  if (existingMessage) {
    // KV doesn't give us cross-key transactions here. If a prior finalize stored the
    // message but crashed before repairing indexes, rebuild them idempotently now.
    await Promise.all([
      updateAgentInbox(
        kv,
        existingMessage.toBtcAddress,
        existingMessage.messageId,
        existingMessage.sentAt
      ),
      ...(staged.senderSentIndexBtcAddress
        ? [updateSentIndex(kv, staged.senderSentIndexBtcAddress, existingMessage.messageId, existingMessage.sentAt)]
        : []),
    ]);
    await deleteStagedInboxPayment(kv, paymentId);
    return existingMessage;
  }

  // This remains best-effort under concurrent polls because Workers KV cannot atomically
  // read/write the staged record, message body, and both indexes in one transaction.
  const finalizedMessage: InboxMessage = {
    ...staged.message,
    ...updates,
    paymentStatus: "confirmed",
    paymentId,
  };

  await Promise.all([
    storeMessage(kv, finalizedMessage),
    updateAgentInbox(kv, finalizedMessage.toBtcAddress, finalizedMessage.messageId, finalizedMessage.sentAt),
    ...(staged.senderSentIndexBtcAddress
      ? [updateSentIndex(kv, staged.senderSentIndexBtcAddress, finalizedMessage.messageId, finalizedMessage.sentAt)]
      : []),
  ]);

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
