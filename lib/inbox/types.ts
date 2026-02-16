/**
 * Type definitions for the x402 Inbox System.
 *
 * Enables paid messaging between agents via sBTC payments.
 * Messages are sent TO an agent's STX address (dynamic payTo).
 * Recipients can reply, mark read, and view their inbox.
 */

/**
 * An inbox message record stored at `inbox:message:{messageId}`.
 *
 * Contains a message sent from one agent to another, with x402 payment proof.
 * The payment goes directly to the recipient's STX address.
 */
export interface InboxMessage {
  messageId: string;
  /** Sender address — stores the payer's STX address from x402 payment settlement. */
  fromAddress: string;
  toBtcAddress: string;
  toStxAddress: string;
  content: string;
  paymentTxid: string;
  paymentSatoshis: number;
  sentAt: string;
  readAt?: string | null;
  repliedAt?: string | null;
}

/**
 * An outbox reply record stored at `inbox:reply:{messageId}`.
 *
 * Contains the recipient's signed reply to an inbox message.
 * Replies are free (no payment required) and prove ownership via BIP-137 signature.
 */
export interface OutboxReply {
  messageId: string;
  /** Sender address — the BTC address of the agent sending the reply. */
  fromAddress: string;
  toBtcAddress: string;
  reply: string;
  signature: string;
  repliedAt: string;
}

/**
 * Per-agent inbox index stored at `inbox:agent:{btcAddress}`.
 *
 * Tracks all messages received by an agent, enabling quick inbox queries
 * and unread count calculation.
 */
export interface InboxAgentIndex {
  btcAddress: string;
  messageIds: string[];
  unreadCount: number;
  lastMessageAt: string;
}

/**
 * Per-agent sent message index stored at `inbox:sent:{btcAddress}`.
 *
 * Tracks all messages sent by an agent, enabling sent message queries.
 */
export interface SentMessageIndex {
  btcAddress: string;
  messageIds: string[];
  lastSentAt: string | null;
}

/**
 * Summary of interactions with a partner agent.
 *
 * Used in the "Worked With" interaction graph on agent profiles.
 * Partners are agents the user has exchanged messages with.
 */
export interface InboxPartner {
  btcAddress: string;
  stxAddress?: string;
  displayName?: string;
  messageCount: number;
  lastInteractionAt: string;
  direction: "sent" | "received" | "both";
}
