/**
 * x402 Inbox System - Barrel Export
 *
 * Provides all types, constants, validation functions, and x402 utilities
 * for the inbox messaging system.
 */

// Types
export type {
  InboxMessage,
  OutboxReply,
  InboxAgentIndex,
  SentMessageIndex,
  RelayPaymentStatus,
  StagedInboxMessage,
  PaymentFailureCache,
} from "./types";

// Constants
export {
  INBOX_PRICE_SATS,
  MAX_MESSAGE_LENGTH,
  MAX_REPLY_LENGTH,
  MARK_READ_MESSAGE_FORMAT,
  REPLY_MESSAGE_FORMAT,
  SENDER_AUTH_MESSAGE_FORMAT,
  SBTC_CONTRACTS,
  KV_PREFIXES,
  REDEEMED_TXID_TTL_SECONDS,
  RELAY_CIRCUIT_BREAKER_KEY,
  RELAY_CIRCUIT_BREAKER_THRESHOLD,
  RELAY_CIRCUIT_BREAKER_TTL_SECONDS,
  RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS,
  RPC_POLL_INTERVAL_MS,
  RPC_POLL_MAX_ATTEMPTS,
  RPC_TOTAL_TIMEOUT_MS,
  PAYMENT_FAILURE_CACHE_PREFIX,
  PAYMENT_FAILURE_CACHE_TTL_SECONDS,
  STAGED_PAYMENT_TTL_SECONDS,
  CACHEABLE_PAYMENT_FAILURE_CODES,
  INBOX_SENDER_RATE_LIMIT_PREFIX,
  INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS,
  INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS,
  buildMarkReadMessage,
  buildReplyMessage,
  buildSenderAuthMessage,
} from "./constants";

// Payment Failure Cache
export { getCachedPaymentFailure, cachePaymentFailure } from "./payment-cache";

// Sender Rate Limiting
export { extractSenderStxAddress, checkSenderRateLimit } from "./sender-rate-limit";

// RPC Types and Helpers
export type {
  RelayRPC,
  RelaySettleOptions,
  RelaySubmitResult,
  RelayCheckResult,
} from "./relay-rpc";
export { submitViaRPC, mapRPCErrorCode } from "./relay-rpc";

// Circuit Breaker
export type { CircuitBreakerState } from "./circuit-breaker";
export {
  checkCircuitBreaker,
  recordRelayFailure,
  resetCircuitBreaker,
} from "./circuit-breaker";

// Validation
export {
  validateInboxMessage,
  validateOutboxReply,
  validateMarkRead,
} from "./validation";

// x402 Payment Verification
export type { InboxPaymentVerification } from "./x402-verify";
export {
  verifyInboxPayment,
  verifyTxidPayment,
} from "./x402-verify";

// x402 Configuration
export {
  getSBTCAsset,
  buildInboxPaymentRequirements,
  DEFAULT_RELAY_URL,
} from "./x402-config";

// KV Helpers
export type { ListInboxOptions, ListInboxResult, ListSentResult } from "./kv-helpers";
export {
  getMessage,
  storeMessage,
  updateMessage,
  getReply,
  storeReply,
  getAgentInbox,
  updateAgentInbox,
  getSentIndex,
  updateSentIndex,
  getStagedInboxPayment,
  storeStagedInboxPayment,
  deleteStagedInboxPayment,
  finalizeStagedInboxPayment,
  listInboxMessages,
  listSentMessages,
  decrementUnreadCount,
} from "./kv-helpers";

export type { InboxReconciliationQueueMessage } from "./reconciliation-queue";
export {
  INBOX_RECONCILIATION_QUEUE_ROUTE,
  enqueueInboxReconciliation,
  processInboxReconciliationQueue,
} from "./reconciliation-queue";
export {
  getPaymentStatusHttpCode,
  reconcileStagedInboxPayment,
} from "./reconcile-staged-payment";
