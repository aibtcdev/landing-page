/**
 * Validation functions for Heartbeat System request bodies.
 *
 * Follows the pattern from lib/admin/validation.ts:
 * - Returns { data: T } on success
 * - Returns { errors: string[] } on validation failure
 */

import { CHECK_IN_TIMESTAMP_WINDOW_MS } from "./constants";
import {
  validateSignatureFormat,
  validateCanonicalISO8601,
} from "@/lib/validation/signature";

/**
 * Validate and parse a check-in submission body.
 *
 * Expected format:
 * {
 *   signature: string,    // Base64 or hex-encoded BIP-137 signature (65 bytes)
 *   timestamp: string     // Canonical ISO 8601 timestamp (must match Date.toISOString() output, e.g. "2026-02-10T12:00:00.000Z") within 5-minute window
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateCheckInBody(body: unknown):
  | {
      data: {
        signature: string;
        timestamp: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // signature — Base64 or hex-encoded (65 bytes = 130 hex chars or ~88 base64 chars)
  if (typeof b.signature !== "string") {
    errors.push("signature must be a string");
  } else {
    errors.push(...validateSignatureFormat(b.signature));
  }

  // timestamp — ISO 8601 date string, within 5-minute window of server time
  if (typeof b.timestamp !== "string") {
    errors.push("timestamp must be a string");
  } else {
    const isoErrors = validateCanonicalISO8601(b.timestamp, "timestamp");
    errors.push(...isoErrors);

    // Only check time window if ISO format is valid
    if (isoErrors.length === 0) {
      const now = Date.now();
      const timestampMs = new Date(b.timestamp).getTime();
      const diff = Math.abs(now - timestampMs);
      if (diff > CHECK_IN_TIMESTAMP_WINDOW_MS) {
        errors.push(
          `timestamp must be within ${CHECK_IN_TIMESTAMP_WINDOW_MS / 1000} seconds of server time`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      signature: b.signature as string,
      timestamp: b.timestamp as string,
    },
  };
}
