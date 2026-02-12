/**
 * Constants for the Heartbeat System.
 */

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
 * KV key prefix for check-in records.
 *
 * Key: "checkin:{btcAddress}"
 * Value: CheckInRecord
 */
export const CHECK_IN_PREFIX = "checkin:";
