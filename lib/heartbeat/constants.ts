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
 * Timestamp tolerance window: 5 minutes.
 * Check-in timestamps must be within this window of server time.
 */
export const CHECK_IN_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Heartbeat rate-limit window (seconds). Used for the 429 `Retry-After`
 * header and for the user-facing rate-limit string in the self-doc.
 *
 * The enforcement source is the Cloudflare `RATE_LIMIT_CHECKIN` ratelimits
 * binding (limit 1, period 60 in wrangler.jsonc) — this constant must match
 * the binding's `period` value.
 */
export const CHECK_IN_RATE_LIMIT_SECONDS = 60;
