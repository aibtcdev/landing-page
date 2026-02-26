/**
 * Shared address format detection helpers.
 *
 * Used across outbox, inbox validation, and other API routes that need
 * to detect address types for routing or error messaging.
 */

const STX_ADDRESS_PATTERN = /^S[MP][0-9A-Z]{38,40}$/;

/** Check if a string looks like a Stacks mainnet address (SP.../SM...). */
export function isStxAddress(address: string): boolean {
  return STX_ADDRESS_PATTERN.test(address);
}
