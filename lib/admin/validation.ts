/**
 * Admin Validation Utilities
 *
 * Pure validation functions for genesis payout fields.
 * All validators return typed results with explicit error messages.
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors?: ValidationError[];
}

/**
 * Validate Bitcoin Native SegWit address (bc1... bech32 format)
 */
export function validateBtcAddress(
  address: string
): ValidationResult<string> {
  if (!address) {
    return {
      valid: false,
      errors: [{ field: "btcAddress", message: "BTC address is required" }],
    };
  }

  if (!address.startsWith("bc1")) {
    return {
      valid: false,
      errors: [
        {
          field: "btcAddress",
          message: "BTC address must start with bc1 (Native SegWit)",
        },
      ],
    };
  }

  // Bech32 addresses are 42-62 characters
  if (address.length < 42 || address.length > 62) {
    return {
      valid: false,
      errors: [
        {
          field: "btcAddress",
          message: "BTC address length invalid (expected 42-62 characters)",
        },
      ],
    };
  }

  // Basic character set check (bech32 uses lowercase alphanumeric, no mixed case)
  if (!/^bc1[a-z0-9]+$/.test(address)) {
    return {
      valid: false,
      errors: [
        {
          field: "btcAddress",
          message:
            "BTC address contains invalid characters (bech32 must be lowercase alphanumeric)",
        },
      ],
    };
  }

  return { valid: true, data: address };
}

/**
 * Validate Bitcoin transaction ID (64-character hex)
 */
export function validateTxid(txid: string): ValidationResult<string> {
  if (!txid) {
    return {
      valid: false,
      errors: [{ field: "rewardTxid", message: "Transaction ID is required" }],
    };
  }

  if (txid.length !== 64) {
    return {
      valid: false,
      errors: [
        {
          field: "rewardTxid",
          message: "Transaction ID must be exactly 64 characters",
        },
      ],
    };
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    return {
      valid: false,
      errors: [
        {
          field: "rewardTxid",
          message: "Transaction ID must be hexadecimal (0-9, a-f)",
        },
      ],
    };
  }

  return { valid: true, data: txid.toLowerCase() };
}

/**
 * Validate ISO 8601 timestamp
 */
export function validateISOTimestamp(
  timestamp: string
): ValidationResult<string> {
  if (!timestamp) {
    return {
      valid: false,
      errors: [{ field: "paidAt", message: "Timestamp is required" }],
    };
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return {
      valid: false,
      errors: [
        {
          field: "paidAt",
          message: "Timestamp must be valid ISO 8601 format",
        },
      ],
    };
  }

  // Ensure the parsed date can round-trip to ISO string
  const isoString = date.toISOString();
  if (isoString !== timestamp) {
    return {
      valid: false,
      errors: [
        {
          field: "paidAt",
          message: "Timestamp must be in strict ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)",
        },
      ],
    };
  }

  return { valid: true, data: timestamp };
}

/**
 * Validate Stacks address (SP... mainnet format)
 */
export function validateStxAddress(
  address: string
): ValidationResult<string> {
  if (!address) {
    return {
      valid: false,
      errors: [{ field: "stxAddress", message: "STX address is required" }],
    };
  }

  if (!address.startsWith("SP")) {
    return {
      valid: false,
      errors: [
        {
          field: "stxAddress",
          message: "STX address must start with SP (mainnet)",
        },
      ],
    };
  }

  // Stacks addresses are 40-41 characters (base58check)
  if (address.length < 40 || address.length > 41) {
    return {
      valid: false,
      errors: [
        {
          field: "stxAddress",
          message: "STX address length invalid (expected 40-41 characters)",
        },
      ],
    };
  }

  // Base58 character set (no 0, O, I, l)
  if (!/^SP[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
    return {
      valid: false,
      errors: [
        {
          field: "stxAddress",
          message: "STX address contains invalid characters (base58)",
        },
      ],
    };
  }

  return { valid: true, data: address };
}

/**
 * Validate full genesis payout request body
 */
export function validateGenesisPayoutBody(body: unknown): ValidationResult<{
  btcAddress: string;
  rewardTxid: string;
  rewardSatoshis: number;
  paidAt: string;
  stxAddress?: string;
}> {
  const errors: ValidationError[] = [];

  // Type check
  if (!body || typeof body !== "object") {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object" }],
    };
  }

  const data = body as Record<string, unknown>;

  // Validate btcAddress
  if (typeof data.btcAddress !== "string") {
    errors.push({
      field: "btcAddress",
      message: "btcAddress must be a string",
    });
  } else {
    const btcResult = validateBtcAddress(data.btcAddress);
    if (!btcResult.valid && btcResult.errors) {
      errors.push(...btcResult.errors);
    }
  }

  // Validate rewardTxid
  if (typeof data.rewardTxid !== "string") {
    errors.push({ field: "rewardTxid", message: "rewardTxid must be a string" });
  } else {
    const txidResult = validateTxid(data.rewardTxid);
    if (!txidResult.valid && txidResult.errors) {
      errors.push(...txidResult.errors);
    }
  }

  // Validate rewardSatoshis
  if (typeof data.rewardSatoshis !== "number") {
    errors.push({
      field: "rewardSatoshis",
      message: "rewardSatoshis must be a number",
    });
  } else if (data.rewardSatoshis <= 0) {
    errors.push({
      field: "rewardSatoshis",
      message: "rewardSatoshis must be greater than 0",
    });
  } else if (!Number.isInteger(data.rewardSatoshis)) {
    errors.push({
      field: "rewardSatoshis",
      message: "rewardSatoshis must be an integer",
    });
  }

  // Validate paidAt
  if (typeof data.paidAt !== "string") {
    errors.push({ field: "paidAt", message: "paidAt must be a string" });
  } else {
    const timeResult = validateISOTimestamp(data.paidAt);
    if (!timeResult.valid && timeResult.errors) {
      errors.push(...timeResult.errors);
    }
  }

  // Validate optional stxAddress
  if (data.stxAddress !== undefined) {
    if (typeof data.stxAddress !== "string") {
      errors.push({
        field: "stxAddress",
        message: "stxAddress must be a string if provided",
      });
    } else {
      const stxResult = validateStxAddress(data.stxAddress);
      if (!stxResult.valid && stxResult.errors) {
        errors.push(...stxResult.errors);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      btcAddress: data.btcAddress as string,
      rewardTxid: data.rewardTxid as string,
      rewardSatoshis: data.rewardSatoshis as number,
      paidAt: data.paidAt as string,
      stxAddress: data.stxAddress as string | undefined,
    },
  };
}
