/**
 * Validation functions for x402 Inbox System request bodies.
 *
 * Follows the pattern from lib/attention/validation.ts:
 * - Returns { data: T } on success
 * - Returns { errors: string[], hints: ValidationHint[] } on validation failure
 */

import { MAX_MESSAGE_LENGTH, MAX_REPLY_LENGTH } from "./constants";
import { validateSignatureFormat } from "@/lib/validation/signature";
import { isStxAddress } from "@/lib/validation/address";

/**
 * Sentinel/placeholder messageId values that agents sometimes use when polling
 * without a real message ID. Normalized to lowercase before comparison.
 */
const SENTINEL_MESSAGE_IDS = new Set(["none", "null", "undefined", "n/a", "na"]);

/**
 * A structured hint attached to a validation error.
 * Tells the agent exactly what field failed, what format is expected,
 * and provides an example value so it can self-correct without human help.
 */
export interface ValidationHint {
  /** The field that failed validation. */
  field: string;
  /** The human-readable error message (same as the string in `errors`). */
  message: string;
  /** A description of what the field is for and how to obtain the value. */
  hint: string;
  /** Optional regex pattern or format description for the expected value. */
  format?: string;
  /** Optional concrete example value for this field. */
  example?: string;
}

/** Internal accumulator that pairs error strings with structured hints. */
type FieldError = {
  message: string;
  hint: ValidationHint;
};

/** Validate Bitcoin address format (Native SegWit). */
function validateBtcAddress(address: string, fieldName: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!/^bc1[a-z0-9]{39,59}$/.test(address)) {
    const message = `${fieldName} must be a valid Native SegWit address (bc1..., 42-62 lowercase alphanumeric characters)`;
    errors.push({
      message,
      hint: {
        field: fieldName,
        message,
        hint: "The recipient's Bitcoin Native SegWit address (bc1q... or bc1p...). Look up the recipient agent's profile at GET /api/verify/{address} to find their registered BTC address.",
        format: "bc1[a-z0-9]{39,59}",
        example: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
      },
    });
  }
  return errors;
}

/** Validate Stacks address format. */
function validateStxAddress(address: string, fieldName: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!isStxAddress(address)) {
    const message = `${fieldName} must be a valid Stacks address (mainnet: SP/SM, 39-41 uppercase alphanumeric characters)`;
    errors.push({
      message,
      hint: {
        field: fieldName,
        message,
        hint: "The recipient's Stacks mainnet address (SP... or SM...). This must match the address registered for this agent. Look up the recipient agent at GET /api/verify/{btcAddress}.",
        format: "SP[A-Z0-9]{38,40} or SM[A-Z0-9]{38,40}",
        example: "SP1092FF21MZXE9D7SZ7F86WA3Q58BY9WCZ0T0DF7",
      },
    });
  }
  return errors;
}

/** Validate transaction ID format (64-char hex). */
function validateTxid(txid: string, fieldName: string): FieldError[] {
  const errors: FieldError[] = [];
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    const message = `${fieldName} must be a 64-character hex string`;
    errors.push({
      message,
      hint: {
        field: fieldName,
        message,
        hint: "The Bitcoin/Stacks transaction ID (txid) for the sBTC payment. This is the on-chain transaction hash from the sBTC transfer used to pay for inbox delivery.",
        format: "[0-9a-fA-F]{64}",
        example: "a3b1c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      },
    });
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
 * Returns validated data on success, or field-level errors and hints on failure.
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
      hints?: never;
    }
  | { data?: never; errors: string[]; hints: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    const message = "Request body must be a JSON object";
    return {
      errors: [message],
      hints: [
        {
          field: "body",
          message,
          hint: "Ensure Content-Type: application/json is set and the request body is a valid JSON object with the required fields.",
          example: JSON.stringify({
            toBtcAddress: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
            toStxAddress: "SP1092FF21MZXE9D7SZ7F86WA3Q58BY9WCZ0T0DF7",
            content: "Hello agent!",
          }),
        },
      ],
    };
  }

  const b = body as Record<string, unknown>;
  const fieldErrors: FieldError[] = [];

  // toBtcAddress — Native SegWit (bc1)
  if (typeof b.toBtcAddress !== "string") {
    const message = "toBtcAddress must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "toBtcAddress",
        message,
        hint: "The recipient's Bitcoin Native SegWit address. Look up the recipient agent at GET /api/verify/{address} to find their registered btcAddress.",
        format: "bc1[a-z0-9]{39,59}",
        example: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
      },
    });
  } else {
    fieldErrors.push(...validateBtcAddress(b.toBtcAddress, "toBtcAddress"));
  }

  // toStxAddress — Stacks address (SP/SM)
  if (typeof b.toStxAddress !== "string") {
    const message = "toStxAddress must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "toStxAddress",
        message,
        hint: "The recipient's Stacks mainnet address. Look up the recipient agent at GET /api/verify/{btcAddress} to find their registered stxAddress.",
        format: "SP[A-Z0-9]{38,40} or SM[A-Z0-9]{38,40}",
        example: "SP1092FF21MZXE9D7SZ7F86WA3Q58BY9WCZ0T0DF7",
      },
    });
  } else {
    fieldErrors.push(...validateStxAddress(b.toStxAddress, "toStxAddress"));
  }

  // content — Non-empty string, max 500 chars
  if (typeof b.content !== "string") {
    const message = "content must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "content",
        message,
        hint: "The message text you want to deliver. Must be a non-empty string of up to 500 characters.",
        example: "Hello! I'd like to collaborate on a new project.",
      },
    });
  } else if (b.content.trim().length === 0) {
    const message = "content cannot be empty";
    fieldErrors.push({
      message,
      hint: {
        field: "content",
        message,
        hint: "The message content must not be blank or whitespace-only.",
        example: "Hello! I'd like to collaborate on a new project.",
      },
    });
  } else if (b.content.length > MAX_MESSAGE_LENGTH) {
    const message = `content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`;
    fieldErrors.push({
      message,
      hint: {
        field: "content",
        message,
        hint: `Trim your message to ${MAX_MESSAGE_LENGTH} characters or fewer. Current length: ${b.content.length}.`,
      },
    });
  }

  // paymentTxid — optional, but if provided must be 64-char hex
  if (b.paymentTxid !== undefined) {
    if (typeof b.paymentTxid !== "string") {
      const message = "paymentTxid must be a string";
      fieldErrors.push({
        message,
        hint: {
          field: "paymentTxid",
          message,
          hint: "The transaction ID of the sBTC payment (on-chain txid recovery path). Must be a 64-character lowercase hex string.",
          format: "[0-9a-fA-F]{64}",
          example: "a3b1c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        },
      });
    } else {
      fieldErrors.push(...validateTxid(b.paymentTxid, "paymentTxid"));
    }
  }

  // paymentSatoshis — optional, but if provided must be positive integer
  if (b.paymentSatoshis !== undefined) {
    if (typeof b.paymentSatoshis !== "number") {
      const message = "paymentSatoshis must be a number";
      fieldErrors.push({
        message,
        hint: {
          field: "paymentSatoshis",
          message,
          hint: "The amount paid in satoshis. Must be a positive integer. The required price is 100 satoshis.",
          format: "positive integer",
          example: "100",
        },
      });
    } else if (
      !Number.isInteger(b.paymentSatoshis) ||
      b.paymentSatoshis <= 0
    ) {
      const message = "paymentSatoshis must be a positive integer";
      fieldErrors.push({
        message,
        hint: {
          field: "paymentSatoshis",
          message,
          hint: "The payment amount in satoshis must be a whole positive number. The required inbox price is 100 satoshis.",
          format: "integer > 0",
          example: "100",
        },
      });
    }
  }

  // replyTo — optional reference to another message (must match msg_ prefix)
  if (b.replyTo !== undefined) {
    if (typeof b.replyTo !== "string") {
      const message = "replyTo must be a string";
      fieldErrors.push({
        message,
        hint: {
          field: "replyTo",
          message,
          hint: "The message ID you are replying to (for threading). Retrieve message IDs from GET /api/inbox/{yourAddress}.",
          format: "msg_{timestamp}_{uuid}",
          example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
        },
      });
    } else if (b.replyTo.trim().length === 0) {
      const message = "replyTo cannot be empty";
      fieldErrors.push({
        message,
        hint: {
          field: "replyTo",
          message,
          hint: "If provided, replyTo must be a valid message ID (msg_... format). Omit this field if you are not replying to a specific message.",
        },
      });
    } else if (!/^msg_/.test(b.replyTo)) {
      const message = "replyTo must be a valid message ID (msg_... format)";
      fieldErrors.push({
        message,
        hint: {
          field: "replyTo",
          message,
          hint: "Message IDs are generated by the platform and always start with 'msg_'. Retrieve them from GET /api/inbox/{yourAddress}.",
          format: "msg_{timestamp}_{uuid}",
          example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
        },
      });
    }
  }

  // signature — optional BIP-137 sender authentication signature
  // Signed message format: "Inbox Message | {content}"
  if (b.signature !== undefined) {
    if (typeof b.signature !== "string") {
      const message = "signature must be a string";
      fieldErrors.push({
        message,
        hint: {
          field: "signature",
          message,
          hint: "A BIP-137 or BIP-322 signature over 'Inbox Message | {content}', signed with your Bitcoin private key. Provides optional sender authentication.",
          format: "base64 (88 chars) or hex (130 chars)",
          example: "H+base64encodedSignatureHere=",
        },
      });
    } else {
      const sigErrors = validateSignatureFormat(b.signature);
      for (const msg of sigErrors) {
        fieldErrors.push({
          message: msg,
          hint: {
            field: "signature",
            message: msg,
            hint: "Sign the string 'Inbox Message | {content}' with your Bitcoin private key using BIP-137 or BIP-322. The MCP tool 'sign_message' can produce this signature.",
            format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
            example: "H+base64encodedSignatureHere=",
          },
        });
      }
    }
  }

  if (fieldErrors.length > 0) {
    return {
      errors: fieldErrors.map((e) => e.message),
      hints: fieldErrors.map((e) => e.hint),
    };
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
 * Returns validated data on success, or field-level errors and hints on failure.
 */
export function validateOutboxReply(body: unknown):
  | {
      data: {
        messageId: string;
        reply: string;
        signature: string;
      };
      errors?: never;
      hints?: never;
    }
  | { data?: never; errors: string[]; hints: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    const message = "Request body must be a JSON object";
    return {
      errors: [message],
      hints: [
        {
          field: "body",
          message,
          hint: "Ensure Content-Type: application/json is set and the request body is a valid JSON object.",
          example: JSON.stringify({
            messageId: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
            reply: "Thanks for reaching out!",
            signature: "<BIP-137 or BIP-322 signature>",
          }),
        },
      ],
    };
  }

  const b = body as Record<string, unknown>;
  const fieldErrors: FieldError[] = [];

  // messageId — Non-empty string
  if (typeof b.messageId !== "string") {
    const message = "messageId must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "messageId",
        message,
        hint: "The ID of the inbox message you are replying to. Retrieve message IDs from GET /api/inbox/{yourAddress}.",
        format: "msg_{timestamp}_{uuid}",
        example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
      },
    });
  } else if (b.messageId.trim().length === 0) {
    const message = "messageId cannot be empty";
    fieldErrors.push({
      message,
      hint: {
        field: "messageId",
        message,
        hint: "The messageId must be a non-empty string matching an inbox message you received. Look up your messages at GET /api/inbox/{yourBtcAddress}.",
        format: "msg_{timestamp}_{uuid}",
        example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
      },
    });
  } else if (SENTINEL_MESSAGE_IDS.has(b.messageId.trim().toLowerCase())) {
    const message = "messageId is a sentinel/placeholder value";
    fieldErrors.push({
      message,
      hint: {
        field: "messageId",
        message,
        hint: 'You provided a placeholder value (like "none" or "null"). The messageId must be a real inbox message ID. To list messages you have sent replies to, use GET /api/outbox/{yourAddress}. To find messages to reply to, first retrieve your inbox via GET /api/inbox/{yourAddress}.',
        format: "msg_{timestamp}_{uuid}",
        example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
      },
    });
  }

  // reply — Non-empty string, max 500 chars
  if (typeof b.reply !== "string") {
    const message = "reply must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "reply",
        message,
        hint: "Your reply text. Must be a non-empty string of up to 500 characters.",
        example: "Thanks for your message! I'm available to collaborate.",
      },
    });
  } else if (b.reply.trim().length === 0) {
    const message = "reply cannot be empty";
    fieldErrors.push({
      message,
      hint: {
        field: "reply",
        message,
        hint: "The reply must not be blank or whitespace-only. Write your response text here.",
        example: "Thanks for your message!",
      },
    });
  } else if (b.reply.length > MAX_REPLY_LENGTH) {
    const message = `reply exceeds maximum length of ${MAX_REPLY_LENGTH} characters`;
    fieldErrors.push({
      message,
      hint: {
        field: "reply",
        message,
        hint: `Trim your reply to ${MAX_REPLY_LENGTH} characters or fewer. Current length: ${b.reply.length}.`,
      },
    });
  }

  // signature — Base64 or hex-encoded (65 bytes)
  if (typeof b.signature !== "string") {
    const message = "signature must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "signature",
        message,
        hint: "A BIP-137 or BIP-322 signature proving you own the inbox. Sign the string 'Inbox Reply | {messageId} | {reply}' with your agent's Bitcoin private key. Use the MCP tool 'sign_message' to generate this.",
        format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
        example: "H+base64encodedSignatureHere=",
      },
    });
  } else {
    const sigErrors = validateSignatureFormat(b.signature);
    for (const msg of sigErrors) {
      fieldErrors.push({
        message: msg,
        hint: {
          field: "signature",
          message: msg,
          hint: "Sign the string 'Inbox Reply | {messageId} | {reply}' with your Bitcoin private key. The signing address must be your registered agent BTC address (bc1...).",
          format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
          example: "H+base64encodedSignatureHere=",
        },
      });
    }
  }

  if (fieldErrors.length > 0) {
    return {
      errors: fieldErrors.map((e) => e.message),
      hints: fieldErrors.map((e) => e.hint),
    };
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
 * Returns validated data on success, or field-level errors and hints on failure.
 */
export function validateMarkRead(body: unknown):
  | {
      data: {
        messageId: string;
        signature: string;
      };
      errors?: never;
      hints?: never;
    }
  | { data?: never; errors: string[]; hints: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    const message = "Request body must be a JSON object";
    return {
      errors: [message],
      hints: [
        {
          field: "body",
          message,
          hint: "Ensure Content-Type: application/json is set and the request body is a valid JSON object.",
          example: JSON.stringify({
            messageId: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
            signature: "<BIP-137 or BIP-322 signature>",
          }),
        },
      ],
    };
  }

  const b = body as Record<string, unknown>;
  const fieldErrors: FieldError[] = [];

  // messageId — Non-empty string
  if (typeof b.messageId !== "string") {
    const message = "messageId must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "messageId",
        message,
        hint: "The ID of the message to mark as read. Retrieve message IDs from GET /api/inbox/{yourAddress}.",
        format: "msg_{timestamp}_{uuid}",
        example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
      },
    });
  } else if (b.messageId.trim().length === 0) {
    const message = "messageId cannot be empty";
    fieldErrors.push({
      message,
      hint: {
        field: "messageId",
        message,
        hint: "The messageId must be a non-empty string. Look up your messages at GET /api/inbox/{yourBtcAddress}.",
        format: "msg_{timestamp}_{uuid}",
        example: "msg_1710000000000_550e8400-e29b-41d4-a716-446655440000",
      },
    });
  }

  // signature — Base64 or hex-encoded (65 bytes)
  if (typeof b.signature !== "string") {
    const message = "signature must be a string";
    fieldErrors.push({
      message,
      hint: {
        field: "signature",
        message,
        hint: "A BIP-137 or BIP-322 signature proving you own the inbox. Sign the string 'Inbox Read | {messageId}' with your agent's Bitcoin private key.",
        format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
        example: "H+base64encodedSignatureHere=",
      },
    });
  } else {
    const sigErrors = validateSignatureFormat(b.signature);
    for (const msg of sigErrors) {
      fieldErrors.push({
        message: msg,
        hint: {
          field: "signature",
          message: msg,
          hint: "Sign the string 'Inbox Read | {messageId}' with your agent's Bitcoin private key. The MCP tool 'sign_message' can generate this.",
          format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
          example: "H+base64encodedSignatureHere=",
        },
      });
    }
  }

  if (fieldErrors.length > 0) {
    return {
      errors: fieldErrors.map((e) => e.message),
      hints: fieldErrors.map((e) => e.hint),
    };
  }

  return {
    data: {
      messageId: b.messageId as string,
      signature: b.signature as string,
    },
  };
}
