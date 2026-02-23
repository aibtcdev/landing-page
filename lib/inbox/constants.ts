/**
 * Constants for the x402 Inbox System.
 */

/**
 * Price for sending an inbox message in satoshis (sBTC).
 *
 * This amount is paid by the sender directly to the recipient's STX address
 * via x402 payment verification with dynamic payTo.
 */
export const INBOX_PRICE_SATS = 100;

/**
 * Maximum allowed length for inbox message content (in characters).
 *
 * Messages longer than this will be rejected. This prevents abuse and
 * ensures messages fit within reasonable storage constraints.
 */
export const MAX_MESSAGE_LENGTH = 500;

/**
 * Maximum allowed length for reply content (in characters).
 *
 * Replies longer than this will be rejected. Same constraint as messages.
 */
export const MAX_REPLY_LENGTH = 500;

/**
 * Message format template for marking a message as read (BIP-137 signing).
 *
 * Recipients sign: "Inbox Read | {messageId}"
 *
 * This format proves ownership of the recipient address and intent to mark
 * the message as read without requiring a paid transaction.
 */
export const MARK_READ_MESSAGE_FORMAT = "Inbox Read | {messageId}";

/**
 * Build the mark-read message format from a message ID.
 *
 * @param messageId - The message ID (e.g., "msg_123")
 * @returns Formatted string: "Inbox Read | {messageId}"
 *
 * @example
 * const message = buildMarkReadMessage("msg_123");
 * // Returns: "Inbox Read | msg_123"
 */
export function buildMarkReadMessage(messageId: string): string {
  return `Inbox Read | ${messageId}`;
}

/**
 * Message format template for inbox replies (BIP-137 signing).
 *
 * Recipients sign: "Inbox Reply | {messageId} | {reply text}"
 *
 * This format ensures replies are bound to a specific message and prove
 * ownership of the recipient address.
 */
export const REPLY_MESSAGE_FORMAT = "Inbox Reply | {messageId} | {reply}";

/**
 * Build the reply message format from a message ID and reply text.
 *
 * @param messageId - The message ID (e.g., "msg_123")
 * @param reply - The reply text
 * @returns Formatted string: "Inbox Reply | {messageId} | {reply}"
 *
 * @example
 * const message = buildReplyMessage("msg_123", "Thanks for the message!");
 * // Returns: "Inbox Reply | msg_123 | Thanks for the message!"
 */
export function buildReplyMessage(messageId: string, reply: string): string {
  return `Inbox Reply | ${messageId} | ${reply}`;
}

/**
 * Message format template for sender authentication (BIP-137 signing).
 *
 * Senders optionally sign: "Inbox Message | {message content}"
 *
 * This format binds the signature to the message content, proving authorship
 * independently of the x402 payment. Signing is opt-in; unsigned messages
 * still work normally with payment-only attribution.
 */
export const SENDER_AUTH_MESSAGE_FORMAT = "Inbox Message | {content}";

/**
 * Build the sender authentication message format from message content.
 *
 * @param content - The message content to authenticate
 * @returns Formatted string: "Inbox Message | {content}"
 *
 * @example
 * const message = buildSenderAuthMessage("Hello, agent!");
 * // Returns: "Inbox Message | Hello, agent!"
 */
export function buildSenderAuthMessage(content: string): string {
  return `Inbox Message | ${content}`;
}

/**
 * sBTC token contract addresses per network.
 *
 * Used for x402 payment verification to ensure payments are made in sBTC only.
 */
export const SBTC_CONTRACTS = {
  mainnet: {
    address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
    name: "sbtc-token",
  },
  testnet: {
    address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
    name: "sbtc-token",
  },
} as const;

/**
 * Timeout for the relay fetch during x402 sponsored transaction settlement (ms).
 *
 * The relay may poll for tx confirmation for up to 60s, but the relay-side
 * timeout fix in the x402-sponsor-relay repository (see PRs #103 and #107)
 * reduced typical response times significantly. 30s gives a generous window
 * while preventing the Cloudflare Worker from hanging indefinitely. If the
 * relay takes longer, the sender can use the txid recovery path as a fallback.
 */
export const RELAY_SETTLE_TIMEOUT_MS = 30_000;

/**
 * TTL for redeemed txid KV keys (90 days in seconds).
 * After this period, the key is automatically deleted.
 * The on-chain record remains as the source of truth.
 */
export const REDEEMED_TXID_TTL_SECONDS = 90 * 24 * 60 * 60; // 7,776,000 seconds

/**
 * KV key prefixes for all inbox system data.
 *
 * All records use prefix-based keys to enable efficient listing and
 * namespace separation from other platform data.
 */
export const KV_PREFIXES = {
  /**
   * Inbox message records.
   * Key: "inbox:message:{messageId}"
   * Value: InboxMessage
   */
  MESSAGE: "inbox:message:",

  /**
   * Reply records.
   * Key: "inbox:reply:{messageId}"
   * Value: OutboxReply
   */
  REPLY: "inbox:reply:",

  /**
   * Per-agent inbox index.
   * Key: "inbox:agent:{btcAddress}"
   * Value: InboxAgentIndex
   */
  AGENT_INDEX: "inbox:agent:",

  /**
   * Per-agent sent message index.
   * Key: "inbox:sent:{btcAddress}"
   * Value: SentMessageIndex
   */
  SENT_INDEX: "inbox:sent:",
} as const;
