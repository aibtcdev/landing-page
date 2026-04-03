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
 * Relay settlement timeout (ms). Set to 20s (~7s margin over the 10s relay
 * polling limit passed via maxTimeoutSeconds, plus ~2.5s relay overhead and
 * ~0.5s RTT). Senders can fall back to txid recovery if this expires.
 */
export const RELAY_SETTLE_TIMEOUT_MS = 20_000;

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
export const OUTBOX_RATE_LIMIT_VALIDATION_MAX = 5;
/** TTL for validation-failure rate limit window (5 minutes). */
export const OUTBOX_RATE_LIMIT_VALIDATION_TTL_SECONDS = 300;

// --- Inbox sender rate limit constants ---

/**
 * KV key prefix for per-sender inbox POST rate limiting.
 * Full key: ratelimit:inbox-sender:{rateLimitKey} (hash of payment header)
 */
export const INBOX_SENDER_RATE_LIMIT_PREFIX = "ratelimit:inbox-sender:";

/** Normal rate limit window (seconds): 1 request per 60 seconds. (60s = Cloudflare KV minimum expirationTtl) */
export const INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS = 60;

/** Stricter rate limit window after payment failure (seconds): 1 request per 60 seconds. */
export const INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS = 60;

/** KV key prefixes for inbox system data. */
export const KV_PREFIXES = {
  MESSAGE: "inbox:message:",       // inbox:message:{messageId} -> InboxMessage
  REPLY: "inbox:reply:",           // inbox:reply:{messageId} -> OutboxReply
  AGENT_INDEX: "inbox:agent:",     // inbox:agent:{btcAddress} -> InboxAgentIndex
  SENT_INDEX: "inbox:sent:",       // inbox:sent:{btcAddress} -> SentMessageIndex
} as const;

// --- Circuit breaker constants ---

/**
 * KV key for the x402 relay circuit breaker state.
 * Suffixed with ":count" for the failure counter key.
 */
export const RELAY_CIRCUIT_BREAKER_KEY = "inbox:relay:circuit-breaker";

/**
 * Number of consecutive relay failures that trip the circuit breaker.
 * Set to 10 to match the sponsor wallet pool size — one bad wallet
 * should not trip the breaker for the entire pool.
 */
export const RELAY_CIRCUIT_BREAKER_THRESHOLD = 10;

/**
 * Seconds the circuit breaker stays open after tripping (1 minute).
 * Observed relay recovery time is ~60s; 300s was a 5x overshoot.
 * Also the rolling window for counting failures.
 */
export const RELAY_CIRCUIT_BREAKER_TTL_SECONDS = 60;

/**
 * Seconds clients should wait before retrying when circuit is open.
 * Matches RELAY_CIRCUIT_BREAKER_TTL_SECONDS.
 */
export const RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS = 60;

// --- Payment failure cache constants ---

/**
 * KV key prefix for per-sender payment failure cache.
 * Full key: ratelimit:payment-failure:{senderStxAddress}
 */
export const PAYMENT_FAILURE_CACHE_PREFIX = "ratelimit:payment-failure:";

/** TTL for cached payment failure entries (5 minutes). */
export const PAYMENT_FAILURE_CACHE_TTL_SECONDS = 300;

/**
 * Relay error codes that are cached per sender.
 * Only add codes where the sender's state won't change without explicit action
 * (e.g., depositing sBTC). Do NOT cache transient errors like NONCE_CONFLICT,
 * RELAY_ERROR, or INVALID_SIGNATURE — those may resolve on retry.
 */
export const CACHEABLE_PAYMENT_FAILURE_CODES = new Set(["INSUFFICIENT_FUNDS"]);

/** KV prefix for pending payment reconciliation records. */
export const PENDING_PAYMENT_PREFIX = "inbox:pending:";
/** TTL for pending payment records — matches relay's 24h KV TTL. */
export const PENDING_PAYMENT_TTL_SECONDS = 86400;

// --- RPC service binding polling constants ---

/** Interval between checkPayment() polls (ms). */
export const RPC_POLL_INTERVAL_MS = 2_000;
/**
 * Maximum number of checkPayment() polls before treating as pending.
 * With poll exhaustion returning pending success (Phase 1), 2 attempts
 * is sufficient — fast path for quick confirmations, then hand off.
 */
export const RPC_POLL_MAX_ATTEMPTS = 2;
/**
 * Total RPC wall-time latency budget (ms).
 * 2 attempts x 2s interval + ~2s overhead = 6s.
 * Kept low so agents get a fast response; pending payments settle asynchronously.
 */
export const RPC_TOTAL_TIMEOUT_MS = 6_000;
