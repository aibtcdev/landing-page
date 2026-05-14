/**
 * Validation for the bounty system POST endpoints.
 *
 * Follows the inbox/validation.ts pattern: returns either `{ data }` or
 * `{ errors }`, where errors are structured ValidationHint objects so an
 * agent can self-correct without human help.
 */

import { isStxAddress } from "@/lib/validation/address";
import { validateSignatureFormat } from "@/lib/validation/signature";
import {
  TITLE_MAX,
  DESCRIPTION_MAX,
  SUBMISSION_MESSAGE_MAX,
  SUBMISSION_URL_MAX,
  TAGS_MAX,
  TAG_LENGTH_MAX,
  MIN_EXPIRY_HOURS,
  MAX_EXPIRY_DAYS,
} from "./constants";

/** Re-exported from the inbox pattern so callers can format error responses uniformly. */
export interface ValidationHint {
  field: string;
  message: string;
  hint: string;
  format?: string;
  example?: string;
}

type FieldError = { message: string; hint: ValidationHint };

function pushBtcAddressError(errors: FieldError[], value: unknown, field: string) {
  if (typeof value !== "string") {
    errors.push({
      message: `${field} must be a string`,
      hint: {
        field,
        message: `${field} must be a string`,
        hint: "A Bitcoin Native SegWit address (bc1q... or bc1p...). For your own address, use the BTC address you registered with.",
        format: "bc1[a-z0-9]{39,59}",
        example: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
      },
    });
    return;
  }
  if (!/^bc1[a-z0-9]{39,59}$/.test(value)) {
    errors.push({
      message: `${field} must be a valid Native SegWit address (bc1..., 42-62 lowercase alphanumeric)`,
      hint: {
        field,
        message: `${field} must be a valid Native SegWit address`,
        hint: "Use a bc1q (P2WPKH) or bc1p (P2TR) address. P2PKH/P2SH addresses are not supported.",
        format: "bc1[a-z0-9]{39,59}",
        example: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
      },
    });
  }
}

function pushStxAddressError(errors: FieldError[], value: unknown, field: string) {
  if (typeof value !== "string" || !isStxAddress(value)) {
    errors.push({
      message: `${field} must be a valid mainnet Stacks address (SP/SM)`,
      hint: {
        field,
        message: `${field} must be a valid Stacks address`,
        hint: "Your Stacks mainnet address — SP or SM prefix.",
        format: "SP[A-Z0-9]{38,40} or SM[A-Z0-9]{38,40}",
        example: "SP1092FF21MZXE9D7SZ7F86WA3Q58BY9WCZ0T0DF7",
      },
    });
  }
}

function pushSignatureError(errors: FieldError[], value: unknown, field: string, messageToSign: string) {
  if (typeof value !== "string") {
    errors.push({
      message: `${field} must be a string`,
      hint: {
        field,
        message: `${field} must be a string`,
        hint: `Sign the message: "${messageToSign}" with your Bitcoin private key (BIP-137 or BIP-322). MCP tool: sign_message.`,
        format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
      },
    });
    return;
  }
  const sigErrors = validateSignatureFormat(value);
  for (const m of sigErrors) {
    errors.push({
      message: m,
      hint: {
        field,
        message: m,
        hint: `Sign the message: "${messageToSign}" with your Bitcoin private key.`,
        format: "base64 (88 chars for BIP-137) or hex (130 chars for BIP-322)",
      },
    });
  }
}

function pushIsoTimestampError(
  errors: FieldError[],
  value: unknown,
  field: string,
  hintText: string
) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push({
      message: `${field} must be an ISO-8601 timestamp`,
      hint: {
        field,
        message: `${field} must be an ISO-8601 timestamp`,
        hint: hintText,
        format: "ISO-8601 (YYYY-MM-DDTHH:mm:ss.sssZ)",
        example: new Date().toISOString(),
      },
    });
  }
}

/** Validate the POST /api/bounties create body. */
export function validateCreateBounty(body: unknown):
  | {
      data: {
        posterBtcAddress: string;
        title: string;
        description: string;
        rewardSats: number;
        expiresAt: string;
        tags?: string[];
        signedAt: string;
        signature: string;
      };
      errors?: never;
    }
  | { data?: never; errors: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    return {
      errors: [
        {
          field: "body",
          message: "Request body must be a JSON object",
          hint: "Set Content-Type: application/json and send a JSON object with the required fields.",
        },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];

  pushBtcAddressError(errors, b.posterBtcAddress, "posterBtcAddress");

  if (typeof b.title !== "string" || b.title.trim().length === 0) {
    errors.push({
      message: "title must be a non-empty string",
      hint: {
        field: "title",
        message: "title must be a non-empty string",
        hint: "Short, action-oriented title for the bounty.",
        example: "Add Spanish translation to the agent registration page",
      },
    });
  } else if (b.title.length > TITLE_MAX) {
    errors.push({
      message: `title exceeds ${TITLE_MAX} characters`,
      hint: {
        field: "title",
        message: `title exceeds ${TITLE_MAX} characters`,
        hint: `Trim to ${TITLE_MAX} or fewer. Current: ${b.title.length}.`,
      },
    });
  }

  if (typeof b.description !== "string" || b.description.trim().length === 0) {
    errors.push({
      message: "description must be a non-empty string",
      hint: {
        field: "description",
        message: "description must be a non-empty string",
        hint: "What needs to be done. Markdown allowed. Be concrete — include acceptance criteria so submitters know what 'done' means.",
      },
    });
  } else if (b.description.length > DESCRIPTION_MAX) {
    errors.push({
      message: `description exceeds ${DESCRIPTION_MAX} characters`,
      hint: {
        field: "description",
        message: `description exceeds ${DESCRIPTION_MAX} characters`,
        hint: `Trim to ${DESCRIPTION_MAX} or fewer. Current: ${b.description.length}.`,
      },
    });
  }

  if (typeof b.rewardSats !== "number" || !Number.isInteger(b.rewardSats) || b.rewardSats <= 0) {
    errors.push({
      message: "rewardSats must be a positive integer",
      hint: {
        field: "rewardSats",
        message: "rewardSats must be a positive integer",
        hint: "Promised reward in satoshis (sBTC). You pay this off-chain after accepting a winner; the platform verifies the on-chain transfer.",
        format: "integer > 0",
        example: "5000",
      },
    });
  }

  pushIsoTimestampError(
    errors,
    b.expiresAt,
    "expiresAt",
    `When the submission window closes. Min ${MIN_EXPIRY_HOURS}h from now, max ${MAX_EXPIRY_DAYS}d from now.`
  );
  if (typeof b.expiresAt === "string") {
    const expiresMs = Date.parse(b.expiresAt);
    const nowMs = Date.now();
    const minMs = nowMs + MIN_EXPIRY_HOURS * 60 * 60 * 1000;
    const maxMs = nowMs + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isNaN(expiresMs)) {
      if (expiresMs < minMs) {
        errors.push({
          message: `expiresAt must be at least ${MIN_EXPIRY_HOURS}h from now`,
          hint: {
            field: "expiresAt",
            message: `expiresAt must be at least ${MIN_EXPIRY_HOURS}h from now`,
            hint: "Give submitters real time to do the work. Bounties closing in under an hour are not allowed.",
          },
        });
      } else if (expiresMs > maxMs) {
        errors.push({
          message: `expiresAt cannot be more than ${MAX_EXPIRY_DAYS} days from now`,
          hint: {
            field: "expiresAt",
            message: `expiresAt cannot be more than ${MAX_EXPIRY_DAYS} days from now`,
            hint: "Bounties with very long expiry tend to be ignored. Pick a realistic deadline.",
          },
        });
      }
    }
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) {
      errors.push({
        message: "tags must be an array of strings",
        hint: {
          field: "tags",
          message: "tags must be an array of strings",
          hint: "Optional tags to categorize the bounty.",
          example: '["translation", "ux"]',
        },
      });
    } else if (b.tags.length > TAGS_MAX) {
      errors.push({
        message: `tags can have at most ${TAGS_MAX} entries`,
        hint: {
          field: "tags",
          message: `tags can have at most ${TAGS_MAX} entries`,
          hint: "Keep tags focused — too many dilutes the signal.",
        },
      });
    } else {
      for (const tag of b.tags) {
        if (typeof tag !== "string" || tag.length === 0 || tag.length > TAG_LENGTH_MAX) {
          errors.push({
            message: `each tag must be a non-empty string up to ${TAG_LENGTH_MAX} chars`,
            hint: {
              field: "tags",
              message: `each tag must be a non-empty string up to ${TAG_LENGTH_MAX} chars`,
              hint: "Tags must be short, non-empty strings.",
            },
          });
          break;
        }
      }
    }
  }

  pushIsoTimestampError(
    errors,
    b.signedAt,
    "signedAt",
    "The ISO timestamp you used when signing. Must be within 5 minutes of server time."
  );

  pushSignatureError(
    errors,
    b.signature,
    "signature",
    "AIBTC Bounty Create | {posterBtcAddress} | {bodyHash} | {signedAt}"
  );

  if (errors.length > 0) {
    return { errors: errors.map((e) => e.hint) };
  }
  return {
    data: {
      posterBtcAddress: b.posterBtcAddress as string,
      title: (b.title as string).trim(),
      description: (b.description as string).trim(),
      rewardSats: b.rewardSats as number,
      expiresAt: b.expiresAt as string,
      ...(Array.isArray(b.tags) && b.tags.length > 0 && { tags: b.tags as string[] }),
      signedAt: b.signedAt as string,
      signature: b.signature as string,
    },
  };
}

/** Validate the POST /api/bounties/[id]/submit body. */
export function validateSubmit(body: unknown):
  | {
      data: {
        submitterBtcAddress: string;
        message: string;
        contentUrl?: string;
        signedAt: string;
        signature: string;
      };
      errors?: never;
    }
  | { data?: never; errors: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    return {
      errors: [
        {
          field: "body",
          message: "Request body must be a JSON object",
          hint: "Send JSON with submitterBtcAddress, message, signedAt, signature (and optional contentUrl).",
        },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];

  pushBtcAddressError(errors, b.submitterBtcAddress, "submitterBtcAddress");

  if (typeof b.message !== "string" || b.message.trim().length === 0) {
    errors.push({
      message: "message must be a non-empty string",
      hint: {
        field: "message",
        message: "message must be a non-empty string",
        hint: "Describe your submission. Include enough detail for the poster to evaluate.",
      },
    });
  } else if (b.message.length > SUBMISSION_MESSAGE_MAX) {
    errors.push({
      message: `message exceeds ${SUBMISSION_MESSAGE_MAX} characters`,
      hint: {
        field: "message",
        message: `message exceeds ${SUBMISSION_MESSAGE_MAX} characters`,
        hint: `Trim to ${SUBMISSION_MESSAGE_MAX} or fewer. Current: ${b.message.length}.`,
      },
    });
  }

  if (b.contentUrl !== undefined) {
    if (typeof b.contentUrl !== "string") {
      errors.push({
        message: "contentUrl must be a string",
        hint: {
          field: "contentUrl",
          message: "contentUrl must be a string",
          hint: "Optional URL linking to your work (PR, gist, demo).",
        },
      });
    } else if (b.contentUrl.length > SUBMISSION_URL_MAX) {
      errors.push({
        message: `contentUrl exceeds ${SUBMISSION_URL_MAX} characters`,
        hint: {
          field: "contentUrl",
          message: `contentUrl exceeds ${SUBMISSION_URL_MAX} characters`,
          hint: "Use a shorter URL.",
        },
      });
    } else if (!/^https?:\/\//.test(b.contentUrl)) {
      errors.push({
        message: "contentUrl must start with http:// or https://",
        hint: {
          field: "contentUrl",
          message: "contentUrl must start with http:// or https://",
          hint: "Provide a full URL.",
          example: "https://github.com/aibtcdev/landing-page/pull/123",
        },
      });
    }
  }

  pushIsoTimestampError(errors, b.signedAt, "signedAt", "The ISO timestamp you used when signing.");
  pushSignatureError(
    errors,
    b.signature,
    "signature",
    "AIBTC Bounty Submit | {bountyId} | {submitterBtcAddress} | {bodyHash} | {signedAt}"
  );

  if (errors.length > 0) return { errors: errors.map((e) => e.hint) };
  return {
    data: {
      submitterBtcAddress: b.submitterBtcAddress as string,
      message: (b.message as string).trim(),
      ...(typeof b.contentUrl === "string" && { contentUrl: b.contentUrl }),
      signedAt: b.signedAt as string,
      signature: b.signature as string,
    },
  };
}

/** Validate the POST /api/bounties/[id]/accept body. */
export function validateAccept(body: unknown):
  | { data: { submissionId: string; signedAt: string; signature: string }; errors?: never }
  | { data?: never; errors: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    return {
      errors: [
        {
          field: "body",
          message: "Request body must be a JSON object",
          hint: "Send JSON with submissionId, signedAt, signature.",
        },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];

  if (typeof b.submissionId !== "string" || b.submissionId.length === 0) {
    errors.push({
      message: "submissionId must be a non-empty string",
      hint: {
        field: "submissionId",
        message: "submissionId must be a non-empty string",
        hint: "The id of the submission you are accepting. Get it from GET /api/bounties/{id}.",
      },
    });
  }

  pushIsoTimestampError(errors, b.signedAt, "signedAt", "ISO timestamp used when signing.");
  pushSignatureError(
    errors,
    b.signature,
    "signature",
    "AIBTC Bounty Accept | {bountyId} | {submissionId} | {signedAt}"
  );

  if (errors.length > 0) return { errors: errors.map((e) => e.hint) };
  return {
    data: {
      submissionId: b.submissionId as string,
      signedAt: b.signedAt as string,
      signature: b.signature as string,
    },
  };
}

/** Validate the POST /api/bounties/[id]/paid body. */
export function validatePaid(body: unknown):
  | { data: { txid: string; signedAt: string; signature: string }; errors?: never }
  | { data?: never; errors: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    return {
      errors: [
        {
          field: "body",
          message: "Request body must be a JSON object",
          hint: "Send JSON with txid, signedAt, signature.",
        },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];

  if (typeof b.txid !== "string" || b.txid.trim().length < 32 || b.txid.length > 200) {
    errors.push({
      message: "txid must be a non-empty string",
      hint: {
        field: "txid",
        message: "txid must be a non-empty string",
        hint: "The confirmed on-chain Stacks transaction ID of the sBTC transfer to the winner. Verify confirmation via the MCP tool get_transaction_status before submitting. The memo must equal BNTY:{bountyId}.",
        example: "0xabc123...",
      },
    });
  }

  pushIsoTimestampError(errors, b.signedAt, "signedAt", "ISO timestamp used when signing.");
  pushSignatureError(
    errors,
    b.signature,
    "signature",
    "AIBTC Bounty Paid | {bountyId} | {txid} | {signedAt}"
  );

  if (errors.length > 0) return { errors: errors.map((e) => e.hint) };
  return {
    data: {
      txid: (b.txid as string).trim(),
      signedAt: b.signedAt as string,
      signature: b.signature as string,
    },
  };
}

/** Validate the POST /api/bounties/[id]/cancel body. */
export function validateCancel(body: unknown):
  | { data: { signedAt: string; signature: string }; errors?: never }
  | { data?: never; errors: ValidationHint[] } {
  if (!body || typeof body !== "object") {
    return {
      errors: [
        {
          field: "body",
          message: "Request body must be a JSON object",
          hint: "Send JSON with signedAt, signature.",
        },
      ],
    };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  pushIsoTimestampError(errors, b.signedAt, "signedAt", "ISO timestamp used when signing.");
  pushSignatureError(
    errors,
    b.signature,
    "signature",
    "AIBTC Bounty Cancel | {bountyId} | {signedAt}"
  );
  if (errors.length > 0) return { errors: errors.map((e) => e.hint) };
  return {
    data: { signedAt: b.signedAt as string, signature: b.signature as string },
  };
}

/** Re-export Stx address helper for route handlers that need quick checks. */
export { isStxAddress };
