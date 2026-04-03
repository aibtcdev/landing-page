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
  /** On-chain transaction ID. Absent while a relay-accepted payment is still staged pending confirmation. */
  paymentTxid?: string;
  paymentSatoshis: number;
  sentAt: string;
  readAt?: string | null;
  repliedAt?: string | null;
  /**
   * BIP-137 signature over "Inbox Message | {content}" provided by the sender.
   * Present only when the sender opted in to cryptographic authentication.
   */
  senderSignature?: string;
  /**
   * Bitcoin address recovered from senderSignature via BIP-137 verification.
   * Proves the sender controls the private key for this address.
   */
  senderBtcAddress?: string;
  /**
   * Whether the message was cryptographically authenticated by the sender.
   * True when senderSignature was present and passed BIP-137 verification.
   */
  authenticated?: boolean;
  /**
   * Whether this message was recovered via txid proof instead of normal x402 settlement.
   * True when the sender resubmitted with a confirmed on-chain txid after settlement timeout.
   */
  recoveredViaTxid?: boolean;
  /**
   * Optional reference to another message this is replying to.
   * Format: "msg_..." (matches the messageId pattern).
   */
  replyTo?: string;
  /**
   * Payment settlement status from the x402 relay.
   * "confirmed" = relay confirmed the transaction on-chain.
   * "pending" = relay accepted the payment and the message is still staged locally.
   * Absent for messages delivered via txid recovery path.
   */
  paymentStatus?: RelayPaymentStatus;
  /** Relay-owned payment identity for staged or confirmed RPC-backed deliveries. */
  paymentId?: string;
  /**
   * Relay receipt ID for polling final confirmation when paymentStatus is "pending".
   * Can be used with the relay's /verify/:receiptId endpoint.
   */
  receiptId?: string;
}

/**
 * Settlement status reported by the x402 relay.
 * - "confirmed": relay confirmed the transaction on-chain.
 * - "pending": relay accepted the payment but the app has not delivered it yet.
 */
export type RelayPaymentStatus = "confirmed" | "pending";

/**
 * Provisional inbox record staged locally until the relay reaches `confirmed`.
 */
export interface StagedInboxMessage {
  paymentId: string;
  message: InboxMessage;
  senderSentIndexBtcAddress?: string;
  createdAt: string;
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
 * Cached payment failure record stored at `ratelimit:payment-failure:{senderStxAddress}`.
 *
 * Written when the relay returns a cacheable error (e.g. INSUFFICIENT_FUNDS).
 * KV TTL controls expiry — no explicit deletion needed.
 */
export interface PaymentFailureCache {
  senderStxAddress: string;
  errorCode: string;
  cachedAt: string;
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
