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
} from "./types";

// Constants
export {
  INBOX_PRICE_SATS,
  MAX_MESSAGE_LENGTH,
  MAX_REPLY_LENGTH,
  MARK_READ_MESSAGE_FORMAT,
  REPLY_MESSAGE_FORMAT,
  SBTC_CONTRACTS,
  KV_PREFIXES,
  buildMarkReadMessage,
  buildReplyMessage,
} from "./constants";

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
} from "./x402-verify";

// x402 Configuration
export {
  getSBTCAsset,
  buildInboxPaymentRequirements,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_SPONSOR_RELAY_URL,
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
  listInboxMessages,
  listSentMessages,
  decrementUnreadCount,
} from "./kv-helpers";
