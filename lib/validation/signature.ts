/**
 * Shared validation functions for BIP-137 signatures and ISO 8601 timestamps.
 *
 * Used across heartbeat, attention, and inbox validation modules.
 */

/** Validate BIP-137 signature format (base64 or hex, 65 bytes). */
export function validateSignatureFormat(signature: string): string[] {
  const errors: string[] = [];
  if (signature.length === 0) {
    errors.push("signature cannot be empty");
  } else {
    const isHex = /^[0-9a-fA-F]+$/.test(signature);
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(signature);
    if (!isHex && !isBase64) {
      errors.push("signature must be base64 or hex-encoded");
    } else if (isHex && signature.length !== 130) {
      errors.push("hex signature must be 130 characters (65 bytes)");
    } else if (isBase64 && signature.length < 86) {
      errors.push("base64 signature appears too short");
    }
  }
  return errors;
}

/** Validate ISO 8601 canonical format (must match Date.toISOString() output). */
export function validateCanonicalISO8601(
  value: string,
  fieldName: string
): string[] {
  const errors: string[] = [];
  const parsed = new Date(value);
  if (isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    errors.push(
      `${fieldName} must be a canonical ISO 8601 date string (e.g. 2026-02-09T12:00:00.000Z)`
    );
  }
  return errors;
}
