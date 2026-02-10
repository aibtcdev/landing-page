/**
 * Constants for the Paid Attention Heartbeat System.
 */

/**
 * Message format template for BIP-137 signing.
 *
 * Agents sign: "Paid Attention | {messageId} | {response text}"
 *
 * This format ensures responses are bound to a specific message and cannot
 * be replayed across different messages.
 */
export const SIGNED_MESSAGE_FORMAT = "Paid Attention | {messageId} | {response}";

/**
 * Build the signed message format from a message ID and response text.
 *
 * This function ensures all message construction uses the canonical format
 * defined by SIGNED_MESSAGE_FORMAT, preventing inconsistencies between
 * message construction and verification.
 *
 * @param messageId - The message ID (e.g., "msg_123")
 * @param response - The response text
 * @returns Formatted string: "Paid Attention | {messageId} | {response}"
 *
 * @example
 * const message = buildSignedMessage("msg_123", "I am paying attention!");
 * // Returns: "Paid Attention | msg_123 | I am paying attention!"
 */
export function buildSignedMessage(messageId: string, response: string): string {
  return `Paid Attention | ${messageId} | ${response}`;
}

/**
 * Message format template for check-in BIP-137 signing.
 *
 * Agents sign: "AIBTC Check-In | {timestamp}"
 *
 * This format ensures check-ins are bound to a specific timestamp and cannot
 * be replayed. The timestamp is verified to be within a 5-minute window of
 * server time.
 */
export const CHECK_IN_MESSAGE_FORMAT = "AIBTC Check-In | {timestamp}";

/**
 * Build the check-in message format from a timestamp.
 *
 * This function ensures all check-in message construction uses the canonical
 * format defined by CHECK_IN_MESSAGE_FORMAT.
 *
 * @param timestamp - ISO 8601 timestamp (e.g., "2026-02-10T12:00:00.000Z")
 * @returns Formatted string: "AIBTC Check-In | {timestamp}"
 *
 * @example
 * const message = buildCheckInMessage("2026-02-10T12:00:00.000Z");
 * // Returns: "AIBTC Check-In | 2026-02-10T12:00:00.000Z"
 */
export function buildCheckInMessage(timestamp: string): string {
  return `AIBTC Check-In | ${timestamp}`;
}

/**
 * Rate limit for check-ins: 5 minutes between check-ins per address.
 */
export const CHECK_IN_RATE_LIMIT_MS = 5 * 60 * 1000;

/**
 * Timestamp tolerance window: 5 minutes.
 * Check-in timestamps must be within this window of server time.
 */
export const CHECK_IN_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Maximum allowed length for response text (in characters).
 *
 * Responses longer than this will be rejected. This prevents abuse and
 * ensures responses fit within reasonable storage and display constraints.
 */
export const MAX_RESPONSE_LENGTH = 500;

/**
 * KV key prefixes for all attention system data.
 *
 * All records use prefix-based keys to enable efficient listing and
 * namespace separation from other platform data.
 */
export const KV_PREFIXES = {
  /**
   * Current active message pointer.
   * Key: "attention:current"
   * Value: AttentionMessage
   */
  CURRENT_MESSAGE: "attention:current",

  /**
   * Archived message records.
   * Key: "attention:message:{messageId}"
   * Value: AttentionMessage
   */
  MESSAGE: "attention:message:",

  /**
   * Agent responses to messages.
   * Key: "attention:response:{messageId}:{btcAddress}"
   * Value: AttentionResponse
   */
  RESPONSE: "attention:response:",

  /**
   * Per-agent response index.
   * Key: "attention:agent:{btcAddress}"
   * Value: AttentionAgentIndex
   */
  AGENT_INDEX: "attention:agent:",

  /**
   * Recorded payouts for responses.
   * Key: "attention:payout:{messageId}:{btcAddress}"
   * Value: AttentionPayout
   */
  PAYOUT: "attention:payout:",

  /**
   * Check-in records.
   * Key: "checkin:{btcAddress}"
   * Value: CheckInRecord
   */
  CHECK_IN: "checkin:",
} as const;
