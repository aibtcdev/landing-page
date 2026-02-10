/**
 * Validation functions for Paid Attention Heartbeat System request bodies.
 *
 * Follows the pattern from lib/admin/validation.ts:
 * - Returns { data: T } on success
 * - Returns { errors: string[] } on validation failure
 * - validatePayoutBody normalizes rewardTxid to lowercase hex
 */

import {
  MAX_RESPONSE_LENGTH,
  CHECK_IN_TIMESTAMP_WINDOW_MS,
} from "./constants";

/**
 * Validate and parse a response submission body.
 *
 * Expected format:
 * {
 *   signature: string,  // Base64 or hex-encoded BIP-137 signature (65 bytes)
 *   response: string    // Response text (max 500 chars)
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateResponseBody(body: unknown):
  | {
      data: {
        signature: string;
        response: string;
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
  } else if (b.signature.length === 0) {
    errors.push("signature cannot be empty");
  } else {
    // Basic length validation - actual signature verification happens later
    const isHex = /^[0-9a-fA-F]+$/.test(b.signature);
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(b.signature);
    if (!isHex && !isBase64) {
      errors.push("signature must be base64 or hex-encoded");
    } else if (isHex && b.signature.length !== 130) {
      errors.push("hex signature must be 130 characters (65 bytes)");
    } else if (isBase64 && b.signature.length < 86) {
      errors.push("base64 signature appears too short");
    }
  }

  // response — Non-empty string, max 500 chars
  if (typeof b.response !== "string") {
    errors.push("response must be a string");
  } else if (b.response.trim().length === 0) {
    errors.push("response cannot be empty");
  } else if (b.response.length > MAX_RESPONSE_LENGTH) {
    errors.push(
      `response exceeds maximum length of ${MAX_RESPONSE_LENGTH} characters`
    );
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      signature: b.signature as string,
      response: b.response as string,
    },
  };
}

/**
 * Validate and parse a payout recording body.
 *
 * Expected format:
 * {
 *   btcAddress: string,      // Native SegWit (bc1...), 42-62 chars
 *   messageId: string,       // Non-empty message ID
 *   rewardTxid: string,      // 64-char hex transaction ID
 *   rewardSatoshis: number,  // Positive integer
 *   paidAt: string           // Canonical ISO 8601 date
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validatePayoutBody(body: unknown):
  | {
      data: {
        btcAddress: string;
        messageId: string;
        rewardTxid: string;
        rewardSatoshis: number;
        paidAt: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // btcAddress — Native SegWit (bc1, bech32)
  if (typeof b.btcAddress !== "string") {
    errors.push("btcAddress must be a string");
  } else if (!/^bc1[a-z0-9]{39,59}$/.test(b.btcAddress)) {
    errors.push(
      "btcAddress must be a valid Native SegWit address (bc1..., 42-62 lowercase alphanumeric characters)"
    );
  }

  // messageId — Non-empty string
  if (typeof b.messageId !== "string") {
    errors.push("messageId must be a string");
  } else if (b.messageId.trim().length === 0) {
    errors.push("messageId cannot be empty");
  }

  // rewardTxid — 64-char hex
  if (typeof b.rewardTxid !== "string") {
    errors.push("rewardTxid must be a string");
  } else if (!/^[0-9a-fA-F]{64}$/.test(b.rewardTxid)) {
    errors.push("rewardTxid must be a 64-character hex string");
  }

  // rewardSatoshis — positive integer
  if (typeof b.rewardSatoshis !== "number") {
    errors.push("rewardSatoshis must be a number");
  } else if (!Number.isInteger(b.rewardSatoshis) || b.rewardSatoshis <= 0) {
    errors.push("rewardSatoshis must be a positive integer");
  }

  // paidAt — ISO 8601 date string, normalized to canonical form
  if (typeof b.paidAt !== "string") {
    errors.push("paidAt must be a string");
  } else {
    const parsed = new Date(b.paidAt);
    if (isNaN(parsed.getTime()) || parsed.toISOString() !== b.paidAt) {
      errors.push(
        "paidAt must be a canonical ISO 8601 date string (e.g. 2026-02-09T12:00:00.000Z)"
      );
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      btcAddress: b.btcAddress as string,
      messageId: b.messageId as string,
      rewardTxid: (b.rewardTxid as string).toLowerCase(),
      rewardSatoshis: b.rewardSatoshis as number,
      paidAt: b.paidAt as string,
    },
  };
}

/**
 * Validate and parse a message rotation body.
 *
 * Expected format:
 * {
 *   content: string,      // Non-empty message content
 *   closedAt?: string     // Optional ISO 8601 date to close previous message
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateMessageBody(body: unknown):
  | {
      data: {
        content: string;
        closedAt?: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // content — Non-empty string
  if (typeof b.content !== "string") {
    errors.push("content must be a string");
  } else if (b.content.trim().length === 0) {
    errors.push("content cannot be empty");
  }

  // closedAt (optional) — ISO 8601 date string, normalized to canonical form
  if (b.closedAt !== undefined) {
    if (typeof b.closedAt !== "string") {
      errors.push("closedAt must be a string if provided");
    } else {
      const parsed = new Date(b.closedAt);
      if (isNaN(parsed.getTime()) || parsed.toISOString() !== b.closedAt) {
        errors.push(
          "closedAt must be a canonical ISO 8601 date string (e.g. 2026-02-09T12:00:00.000Z)"
        );
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      content: b.content as string,
      closedAt: b.closedAt as string | undefined,
    },
  };
}

/**
 * Validate and parse a check-in submission body.
 *
 * Expected format:
 * {
 *   type: "check-in",     // String literal for type discrimination
 *   signature: string,    // Base64 or hex-encoded BIP-137 signature (65 bytes)
 *   timestamp: string     // Canonical ISO 8601 timestamp (must match Date.toISOString() output, e.g. "2026-02-10T12:00:00.000Z") within 5-minute window
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateCheckInBody(body: unknown):
  | {
      data: {
        type: "check-in";
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

  // type — Must be exactly "check-in"
  if (b.type !== "check-in") {
    errors.push('type must be "check-in"');
  }

  // signature — Base64 or hex-encoded (65 bytes = 130 hex chars or ~88 base64 chars)
  if (typeof b.signature !== "string") {
    errors.push("signature must be a string");
  } else if (b.signature.length === 0) {
    errors.push("signature cannot be empty");
  } else {
    // Basic length validation - actual signature verification happens later
    const isHex = /^[0-9a-fA-F]+$/.test(b.signature);
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(b.signature);
    if (!isHex && !isBase64) {
      errors.push("signature must be base64 or hex-encoded");
    } else if (isHex && b.signature.length !== 130) {
      errors.push("hex signature must be 130 characters (65 bytes)");
    } else if (isBase64 && b.signature.length < 86) {
      errors.push("base64 signature appears too short");
    }
  }

  // timestamp — ISO 8601 date string, within 5-minute window of server time
  if (typeof b.timestamp !== "string") {
    errors.push("timestamp must be a string");
  } else {
    const parsed = new Date(b.timestamp);
    if (isNaN(parsed.getTime()) || parsed.toISOString() !== b.timestamp) {
      errors.push(
        "timestamp must be a canonical ISO 8601 date string (e.g. 2026-02-10T12:00:00.000Z)"
      );
    } else {
      // Verify timestamp is within the allowed window
      const now = Date.now();
      const timestampMs = parsed.getTime();
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
      type: "check-in",
      signature: b.signature as string,
      timestamp: b.timestamp as string,
    },
  };
}
