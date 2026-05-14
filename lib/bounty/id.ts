/**
 * Bounty and submission ID generators.
 *
 * Format: base36 millisecond timestamp + 12 hex chars of randomness.
 * Total length ~22 chars — fits the SIP-010 memo budget (34 bytes minus the
 * 5-byte `BNTY:` prefix). Roughly sortable by creation time.
 */

/** Generate a new bounty id. */
export function generateBountyId(): string {
  return `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Generate a new submission id. Same format as bounty id; lives in its own table. */
export function generateSubmissionId(): string {
  return `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
