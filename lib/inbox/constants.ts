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

/** KV key prefixes for inbox system data. */
export const KV_PREFIXES = {
  MESSAGE: "inbox:message:",       // inbox:message:{messageId} -> InboxMessage
  REPLY: "inbox:reply:",           // inbox:reply:{messageId} -> OutboxReply
  AGENT_INDEX: "inbox:agent:",     // inbox:agent:{btcAddress} -> InboxAgentIndex
  SENT_INDEX: "inbox:sent:",       // inbox:sent:{btcAddress} -> SentMessageIndex
  STAGED_PAYMENT: "inbox:staged-payment:", // inbox:staged-payment:{paymentId} -> StagedInboxMessage
} as const;

/** TTL for staged inbox payment records (7 days). */
export const STAGED_PAYMENT_TTL_SECONDS = 7 * 24 * 60 * 60;

// --- Circuit breaker constants ---

// RELAY_CIRCUIT_BREAKER_KEY and RELAY_CIRCUIT_BREAKER_THRESHOLD removed in
// P4 — the threshold + key are now expressed by the
// `RATE_LIMIT_RELAY_FAILURES` ratelimits binding (10 failures / 60s on
// key "relay-failures"), declared in `wrangler.jsonc`. See
// `phases/P4/design-call.md`.

/**
 * Seconds the circuit breaker stays open after tripping (1 minute).
 * Observed relay recovery time is ~60s; 300s was a 5x overshoot. Also
 * the cache-default TTL for the per-colo "circuit-open" memo written
 * by `lib/inbox/circuit-breaker.ts:recordRelayFailure`.
 */
export const RELAY_CIRCUIT_BREAKER_TTL_SECONDS = 60;

/**
 * Seconds clients should wait before retrying when circuit is open.
 * Matches RELAY_CIRCUIT_BREAKER_TTL_SECONDS.
 */
export const RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS = 60;

/**
 * Failure threshold that trips the breaker, mirrored for log/telemetry context.
 *
 * The authoritative config is the `RATE_LIMIT_RELAY_FAILURES` ratelimits binding
 * in `wrangler.jsonc` (`{ limit: 10, period: 60 }` — 10 failures / 60s rolling
 * window). These constants exist only so `circuit-breaker.opened` logs can
 * report the actual trip threshold alongside the marker TTL — keep them in sync
 * with the binding if it's ever retuned (#895).
 */
export const RELAY_CIRCUIT_BREAKER_BINDING_LIMIT = 10;
export const RELAY_CIRCUIT_BREAKER_BINDING_PERIOD_SECONDS = 60;

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

// --- Sponsor nonce TTL constants ---

/**
 * Mirror of STALE_THRESHOLD_MS in the relay's NonceDO (currently 10 minutes).
 *
 * After this duration the relay may reclaim the sponsor nonce assigned to a
 * submitted payment, making the original sponsored hex invalid for rebroadcast.
 *
 * Used to populate `nonceExpiresAt` in StagedInboxMessage at submission time
 * and to detect expiry in the reconciliation queue.
 *
 * MUST stay in sync with the relay's `STALE_THRESHOLD_MS` constant in
 * `src/durable-objects/nonce-do.ts`.  The relay also publishes this value as
 * `sponsorNonceValidForMs` in its `/sponsor` and `/relay` responses (Phase 3,
 * issue #374).  When the relay response includes that field, prefer it over
 * this constant for forward-compatibility.
 */
export const SPONSOR_NONCE_TTL_MS = 10 * 60 * 1000; // 600 000 ms

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
