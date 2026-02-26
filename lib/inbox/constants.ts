/**
 * Constants for the x402 Inbox System.
 */

/** Price per inbox message in satoshis (sBTC), paid directly to recipient. */
export const INBOX_PRICE_SATS = 100;

/** Maximum inbox message content length (characters). */
export const MAX_MESSAGE_LENGTH = 500;

/** Maximum reply content length (characters). */
export const MAX_REPLY_LENGTH = 500;

/** BIP-137 signing format for marking messages as read. */
export const MARK_READ_MESSAGE_FORMAT = "Inbox Read | {messageId}";

export function buildMarkReadMessage(messageId: string): string {
  return `Inbox Read | ${messageId}`;
}

/** BIP-137 signing format for inbox replies (bound to specific message). */
export const REPLY_MESSAGE_FORMAT = "Inbox Reply | {messageId} | {reply}";

export function buildReplyMessage(messageId: string, reply: string): string {
  return `Inbox Reply | ${messageId} | ${reply}`;
}

/** BIP-137 signing format for optional sender authentication (opt-in). */
export const SENDER_AUTH_MESSAGE_FORMAT = "Inbox Message | {content}";

export function buildSenderAuthMessage(content: string): string {
  return `Inbox Message | ${content}`;
}

/** sBTC token contract addresses per network for x402 payment verification. */
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
 * Relay settlement timeout (ms). 30s balances generous wait time against
 * Worker limits. Senders can fall back to txid recovery if this expires.
 */
export const RELAY_SETTLE_TIMEOUT_MS = 30_000;

/** TTL for redeemed txid KV keys (90 days). On-chain record is source of truth. */
export const REDEEMED_TXID_TTL_SECONDS = 90 * 24 * 60 * 60;

// --- Outbox rate limit constants ---

/** Max outbox POST attempts per unregistered address before 429. */
export const OUTBOX_RATE_LIMIT_UNREGISTERED_MAX = 5;
/** TTL for unregistered outbox rate limit window (1 hour). */
export const OUTBOX_RATE_LIMIT_UNREGISTERED_TTL_SECONDS = 3600;

/** Max outbox POST requests per registered address per window. */
export const OUTBOX_RATE_LIMIT_REGISTERED_MAX = 10;
/** TTL for registered outbox rate limit window (1 minute). */
export const OUTBOX_RATE_LIMIT_REGISTERED_TTL_SECONDS = 60;

/** Max validation failures per IP per window before 429. */
export const OUTBOX_RATE_LIMIT_VALIDATION_MAX = 10;
/** TTL for validation-failure rate limit window (10 minutes). */
export const OUTBOX_RATE_LIMIT_VALIDATION_TTL_SECONDS = 600;

/** KV key prefixes for inbox system data. */
export const KV_PREFIXES = {
  MESSAGE: "inbox:message:",       // inbox:message:{messageId} -> InboxMessage
  REPLY: "inbox:reply:",           // inbox:reply:{messageId} -> OutboxReply
  AGENT_INDEX: "inbox:agent:",     // inbox:agent:{btcAddress} -> InboxAgentIndex
  SENT_INDEX: "inbox:sent:",       // inbox:sent:{btcAddress} -> SentMessageIndex
} as const;
