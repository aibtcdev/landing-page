/**
 * Validate and parse a genesis payout request body.
 *
 * Returns validated data on success, or an array of field-level error
 * messages on failure. Validation rules match the KV record schema:
 * - btcAddress: bc1... bech32, 42-62 chars, lowercase alphanumeric
 * - rewardTxid: 64-char hex, normalized to lowercase
 * - rewardSatoshis: positive integer
 * - paidAt: valid ISO 8601 date string
 * - stxAddress (optional): SP... base58, 40-41 chars
 */
export function validateGenesisPayoutBody(body: unknown):
  | {
      data: {
        btcAddress: string;
        rewardTxid: string;
        rewardSatoshis: number;
        paidAt: string;
        stxAddress?: string;
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

  // paidAt — parseable date string
  if (typeof b.paidAt !== "string") {
    errors.push("paidAt must be a string");
  } else if (isNaN(new Date(b.paidAt).getTime())) {
    errors.push("paidAt must be a valid ISO 8601 date string");
  }

  // stxAddress (optional) — SP... base58, 40-41 chars
  if (b.stxAddress !== undefined) {
    if (typeof b.stxAddress !== "string") {
      errors.push("stxAddress must be a string if provided");
    } else if (!/^SP[1-9A-HJ-NP-Za-km-z]{38,39}$/.test(b.stxAddress)) {
      errors.push(
        "stxAddress must be a valid Stacks mainnet address (SP..., 40-41 base58 characters)"
      );
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      btcAddress: b.btcAddress as string,
      rewardTxid: (b.rewardTxid as string).toLowerCase(),
      rewardSatoshis: b.rewardSatoshis as number,
      paidAt: b.paidAt as string,
      stxAddress: b.stxAddress as string | undefined,
    },
  };
}
