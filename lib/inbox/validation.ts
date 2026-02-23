/**
 * Validation functions for x402 Inbox System request bodies.
 *
 * Follows the pattern from lib/attention/validation.ts:
 * - Returns { data: T } on success
 * - Returns { errors: string[] } on validation failure
 */

import { MAX_MESSAGE_LENGTH, MAX_REPLY_LENGTH } from "./constants";
import { validateSignatureFormat } from "@/lib/validation/signature";

/** Validate Bitcoin address format (Native SegWit). */
function validateBtcAddress(address: string, fieldName: string): string[] {
  const errors: string[] = [];
  if (!/^bc1[a-z0-9]{39,59}$/.test(address)) {
    errors.push(
      `${fieldName} must be a valid Native SegWit address (bc1..., 42-62 lowercase alphanumeric characters)`
    );
  }
  return errors;
}

/** Validate Stacks address format. */
function validateStxAddress(address: string, fieldName: string): string[] {
  const errors: string[] = [];
  if (!/^S[MP][0-9A-Z]{38,40}$/.test(address)) {
    errors.push(
      `${fieldName} must be a valid Stacks address (mainnet: SP/SM, 39-41 uppercase alphanumeric characters)`
    );
  }
  return errors;
}

/** Validate transaction ID format (64-char hex). */
function validateTxid(txid: string, fieldName: string): string[] {
  const errors: string[] = [];
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    errors.push(`${fieldName} must be a 64-character hex string`);
  }
  return errors;
}

/**
 * Validate and parse an inbox message submission body.
 *
 * Expected format:
 * {
 *   toBtcAddress: string,      // Recipient BTC address (bc1...)
 *   toStxAddress: string,      // Recipient STX address (SP/SM...)
 *   content: string,           // Message content (max 500 chars)
 *   paymentTxid?: string,      // x402 payment transaction ID (64-char hex, optional for initial 402 request)
 *   paymentSatoshis?: number,  // Payment amount in satoshis (positive integer, optional for initial 402 request)
 *   signature?: string         // BIP-137 signature over "Inbox Message | {content}" (optional, sender authentication)
 * }
 *
 * The paymentTxid and paymentSatoshis fields are optional because the x402 flow
 * returns 402 on the first POST before the sender has a txid. The handler checks
 * for payment-signature header first; if absent, only recipient + content are needed.
 *
 * The signature field is optional. When present, the handler verifies it as a BIP-137
 * signature over "Inbox Message | {content}" and stores the recovered address as
 * senderBtcAddress on the message. Unsigned messages continue to work unchanged.
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateInboxMessage(body: unknown):
  | {
      data: {
        toBtcAddress: string;
        toStxAddress: string;
        content: string;
        paymentTxid?: string;
        paymentSatoshis?: number;
        signature?: string;
        replyTo?: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // toBtcAddress — Native SegWit (bc1)
  if (typeof b.toBtcAddress !== "string") {
    errors.push("toBtcAddress must be a string");
  } else {
    errors.push(...validateBtcAddress(b.toBtcAddress, "toBtcAddress"));
  }

  // toStxAddress — Stacks address (SP/SM)
  if (typeof b.toStxAddress !== "string") {
    errors.push("toStxAddress must be a string");
  } else {
    errors.push(...validateStxAddress(b.toStxAddress, "toStxAddress"));
  }

  // content — Non-empty string, max 500 chars
  if (typeof b.content !== "string") {
    errors.push("content must be a string");
  } else if (b.content.trim().length === 0) {
    errors.push("content cannot be empty");
  } else if (b.content.length > MAX_MESSAGE_LENGTH) {
    errors.push(
      `content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`
    );
  }

  // paymentTxid — optional, but if provided must be 64-char hex
  if (b.paymentTxid !== undefined) {
    if (typeof b.paymentTxid !== "string") {
      errors.push("paymentTxid must be a string");
    } else {
      errors.push(...validateTxid(b.paymentTxid, "paymentTxid"));
    }
  }

  // paymentSatoshis — optional, but if provided must be positive integer
  if (b.paymentSatoshis !== undefined) {
    if (typeof b.paymentSatoshis !== "number") {
      errors.push("paymentSatoshis must be a number");
    } else if (
      !Number.isInteger(b.paymentSatoshis) ||
      b.paymentSatoshis <= 0
    ) {
      errors.push("paymentSatoshis must be a positive integer");
    }
  }

  // replyTo — optional reference to another message (must match msg_ prefix)
  if (b.replyTo !== undefined) {
    if (typeof b.replyTo !== "string") {
      errors.push("replyTo must be a string");
    } else if (b.replyTo.trim().length === 0) {
      errors.push("replyTo cannot be empty");
    } else if (!/^msg_/.test(b.replyTo)) {
      errors.push("replyTo must be a valid message ID (msg_... format)");
    }
  }

  // signature — optional BIP-137 sender authentication signature
  // Signed message format: "Inbox Message | {content}"
  if (b.signature !== undefined) {
    if (typeof b.signature !== "string") {
      errors.push("signature must be a string");
    } else {
      errors.push(...validateSignatureFormat(b.signature));
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      toBtcAddress: b.toBtcAddress as string,
      toStxAddress: b.toStxAddress as string,
      content: b.content as string,
      ...(typeof b.paymentTxid === "string" && {
        paymentTxid: b.paymentTxid.toLowerCase(),
      }),
      ...(typeof b.paymentSatoshis === "number" && {
        paymentSatoshis: b.paymentSatoshis as number,
      }),
      ...(typeof b.signature === "string" && {
        signature: b.signature,
      }),
      ...(typeof b.replyTo === "string" && {
        replyTo: b.replyTo,
      }),
    },
  };
}

/**
 * Validate and parse an outbox reply submission body.
 *
 * Expected format:
 * {
 *   messageId: string,   // Message ID being replied to
 *   reply: string,       // Reply text (max 500 chars)
 *   signature: string    // BIP-137 signature (base64 or hex)
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateOutboxReply(body: unknown):
  | {
      data: {
        messageId: string;
        reply: string;
        signature: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // messageId — Non-empty string
  if (typeof b.messageId !== "string") {
    errors.push("messageId must be a string");
  } else if (b.messageId.trim().length === 0) {
    errors.push("messageId cannot be empty");
  }

  // reply — Non-empty string, max 500 chars
  if (typeof b.reply !== "string") {
    errors.push("reply must be a string");
  } else if (b.reply.trim().length === 0) {
    errors.push("reply cannot be empty");
  } else if (b.reply.length > MAX_REPLY_LENGTH) {
    errors.push(
      `reply exceeds maximum length of ${MAX_REPLY_LENGTH} characters`
    );
  }

  // signature — Base64 or hex-encoded (65 bytes)
  if (typeof b.signature !== "string") {
    errors.push("signature must be a string");
  } else {
    errors.push(...validateSignatureFormat(b.signature));
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      messageId: b.messageId as string,
      reply: b.reply as string,
      signature: b.signature as string,
    },
  };
}

/**
 * Validate and parse a mark-read submission body.
 *
 * Expected format:
 * {
 *   messageId: string,   // Message ID to mark as read
 *   signature: string    // BIP-137 signature (base64 or hex)
 * }
 *
 * Returns validated data on success, or field-level errors on failure.
 */
export function validateMarkRead(body: unknown):
  | {
      data: {
        messageId: string;
        signature: string;
      };
      errors?: never;
    }
  | { data?: never; errors: string[] } {
  if (!body || typeof body !== "object") {
    return { errors: ["Request body must be a JSON object"] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // messageId — Non-empty string
  if (typeof b.messageId !== "string") {
    errors.push("messageId must be a string");
  } else if (b.messageId.trim().length === 0) {
    errors.push("messageId cannot be empty");
  }

  // signature — Base64 or hex-encoded (65 bytes)
  if (typeof b.signature !== "string") {
    errors.push("signature must be a string");
  } else {
    errors.push(...validateSignatureFormat(b.signature));
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      messageId: b.messageId as string,
      signature: b.signature as string,
    },
  };
}
