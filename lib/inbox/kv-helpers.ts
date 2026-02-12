/**
 * KV helper functions for the Inbox System.
 *
 * Provides storage and retrieval operations for inbox messages, replies,
 * and agent inbox indices. Follows the pattern from lib/achievements/kv.ts.
 */

import { KV_PREFIXES } from "./constants";
import type {
  InboxMessage,
  OutboxReply,
  InboxAgentIndex,
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
 * Get an inbox message by ID.
 *
 * @param kv - Cloudflare KV namespace
 * @param messageId - Message ID
 * @returns InboxMessage or null if not found
 *
 * @example
 * const message = await getMessage(kv, "msg_123");
 * if (message) {
 *   console.log(`Message from: ${message.fromBtcAddress}`);
 * }
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
 *   fromBtcAddress: "bc1q...",
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
 *
 * @example
 * const reply = await getReply(kv, "msg_123");
 * if (reply) {
 *   console.log(`Reply: ${reply.reply}`);
 * }
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
 *   fromBtcAddress: "bc1q...",
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
 * List inbox messages for an agent with pagination.
 *
 * Fetches all messages from the agent's inbox index and applies limit/offset.
 *
 * @param kv - Cloudflare KV namespace
 * @param btcAddress - Bitcoin address
 * @param limit - Maximum number of messages to return (default 20)
 * @param offset - Number of messages to skip (default 0)
 * @returns Array of InboxMessages (newest first)
 *
 * @example
 * const messages = await listInboxMessages(kv, "bc1q...", 10, 0);
 * console.log(`First 10 messages: ${messages.length}`);
 */
export async function listInboxMessages(
  kv: KVNamespace,
  btcAddress: string,
  limit = 20,
  offset = 0
): Promise<InboxMessage[]> {
  const index = await getAgentInbox(kv, btcAddress);
  if (!index || index.messageIds.length === 0) {
    return [];
  }

  // Reverse to get newest first
  const messageIds = [...index.messageIds].reverse();

  // Apply pagination
  const paginatedIds = messageIds.slice(offset, offset + limit);

  // Fetch all messages in parallel
  const messages = await Promise.all(
    paginatedIds.map((id) => getMessage(kv, id))
  );

  // Filter out nulls (messages that failed to parse or were deleted)
  return messages.filter((m): m is InboxMessage => m !== null);
}
