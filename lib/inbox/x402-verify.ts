/**
 * x402 Payment Verification for Inbox Messages
 *
 * Verifies sBTC payments sent directly to recipient agents via x402 protocol.
 * Handles both sponsored and non-sponsored transactions.
 *
 * Key difference from x402-api middleware:
 * - Dynamic payTo: recipient agent's STX address (not a single platform address)
 * - Next.js-compatible: no Hono middleware, direct function calls
 * - sBTC-only: rejects STX and USDCx payments
 */

import {
  X402PaymentVerifier,
  networkToCAIP2,
  X402_ERROR_CODES,
} from "x402-stacks";
import type {
  PaymentPayloadV2,
  SettlementResponseV2,
  PaymentRequirementsV2,
} from "x402-stacks";
import { deserializeTransaction, AuthType } from "@stacks/transactions";
import {
  buildInboxPaymentRequirements,
  getSBTCAsset,
  DEFAULT_RELAY_URL,
} from "./x402-config";
import { INBOX_PRICE_SATS, RELAY_SETTLE_TIMEOUT_MS, SBTC_CONTRACTS } from "./constants";
import type { RelayPaymentStatus } from "./types";
import type { Logger } from "../logging";
import { stacksApiFetch, buildHiroHeaders } from "../stacks-api-fetch";
import { getCachedTransaction, setCachedTransaction } from "../identity/kv-cache";

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Subset of Stacks API transaction response used for sBTC transfer validation. */
interface StacksTxData {
  tx_id: string;
  tx_status: string;
  sender_address: string;
  tx_type: string;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: Array<{
      name: string;
      type: string;
      repr: string;
    }>;
  };
}

/**
 * Typed error codes for x402 inbox payment failures.
 *
 * - NONCE_CONFLICT: wallet nonce race; same tx hex is idempotent within 5 min — retry immediately.
 * - BROADCAST_FAILED: relay could not broadcast tx; funds safe, retry with new payment.
 * - SETTLEMENT_TIMEOUT: relay gave up polling but tx was broadcast; recover via paymentTxid.
 * - INSUFFICIENT_FUNDS: sBTC balance too low.
 * - PAYMENT_REJECTED: relay or verifier rejected the payment (bad payload, wrong recipient, etc.).
 * - RELAY_ERROR: relay 5xx or unexpected failure.
 */
export type InboxPaymentErrorCode =
  | "NONCE_CONFLICT"
  | "BROADCAST_FAILED"
  | "SETTLEMENT_TIMEOUT"
  | "INSUFFICIENT_FUNDS"
  | "PAYMENT_REJECTED"
  | "RELAY_ERROR"
  | string; // pass-through for other x402 / txid error codes

/**
 * Result of x402 payment verification for inbox messages.
 */
export interface InboxPaymentVerification {
  success: boolean;
  payerStxAddress?: string;
  paymentTxid?: string;
  /** @deprecated Message IDs are now always generated server-side in the route handler. */
  messageId?: string;
  error?: string;
  errorCode?: InboxPaymentErrorCode;
  settleResult?: SettlementResponseV2;
  /** Settlement status from relay: "confirmed" when tx is final, "pending" when relay timed out but tx was broadcast. */
  paymentStatus?: RelayPaymentStatus;
  /** Relay receipt ID for polling final confirmation when paymentStatus is "pending". */
  receiptId?: string;
  /** Seconds to wait before retrying (only set for retryable errors like NONCE_CONFLICT). */
  retryAfterSeconds?: number;
}

/** Relay error codes that warrant a single immediate retry (relay is idempotent within 5 min). */
const RELAY_RETRYABLE_CODES = new Set([
  "NONCE_CONFLICT",
  "CLIENT_NONCE_CONFLICT",
  "CLIENT_BAD_NONCE",
]);

/**
 * Map a relay error code to a typed InboxPaymentErrorCode.
 * Used by both sponsored and non-sponsored settlement paths.
 */
function mapRelayErrorCode(
  relayCode: string | undefined,
  httpStatus: number
): InboxPaymentErrorCode {
  if (!relayCode) {
    return httpStatus >= 500 ? "RELAY_ERROR" : "PAYMENT_REJECTED";
  }
  if (RELAY_RETRYABLE_CODES.has(relayCode)) return "NONCE_CONFLICT";
  if (relayCode === "BROADCAST_FAILED" || relayCode === "TX_BROADCAST_ERROR") return "BROADCAST_FAILED";
  if (relayCode === "SETTLEMENT_TIMEOUT" || relayCode === "POLL_TIMEOUT") return "SETTLEMENT_TIMEOUT";
  if (relayCode === "INSUFFICIENT_FUNDS" || relayCode === "BALANCE_ERROR") return "INSUFFICIENT_FUNDS";
  if (httpStatus >= 500) return "RELAY_ERROR";
  return "PAYMENT_REJECTED";
}

/**
 * Verify x402 sBTC payment for an inbox message.
 *
 * Validates sBTC-only payment, minimum amount, and correct recipient.
 * Routes sponsored transactions through the relay; non-sponsored through
 * x402 verifier settle flow.
 */
export async function verifyInboxPayment(
  paymentPayload: PaymentPayloadV2,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  relayUrl: string = DEFAULT_RELAY_URL,
  logger?: Logger
): Promise<InboxPaymentVerification> {
  const log = logger || NOOP_LOGGER;

  // Validate network and asset
  const networkCAIP2 = networkToCAIP2(network);
  const expectedAsset = getSBTCAsset(network);

  // Build payment requirements with dynamic payTo
  const paymentRequirements: PaymentRequirementsV2 = buildInboxPaymentRequirements(
    recipientStxAddress,
    network,
    networkCAIP2
  );

  log.debug("Verifying inbox payment", {
    recipientStxAddress,
    expectedAsset,
    network: networkCAIP2,
    minAmount: paymentRequirements.amount,
  });

  // Check if payment is in sBTC (v2: check accepted.asset and payload.transaction)
  if (
    !paymentPayload.payload?.transaction ||
    paymentPayload.accepted.asset !== expectedAsset
  ) {
    log.warn("Payment rejected: not sBTC", {
      acceptedAsset: paymentPayload.accepted.asset,
      expectedAsset,
    });
    return {
      success: false,
      error: "Inbox messages require sBTC payment",
      errorCode: X402_ERROR_CODES.INVALID_PAYLOAD,
    };
  }

  // Message IDs are generated server-side in the route handler (not here).
  // paymentPayload.resource.url is the endpoint URL, not a message ID.

  // Determine if transaction is sponsored using stacks.js deserialization
  const txHex = paymentPayload.payload.transaction;
  const tx = deserializeTransaction(txHex);
  const isSponsored = tx.auth.authType === AuthType.Sponsored;

  // Route all transactions through the relay (sponsored and non-sponsored)
  let settleResult: SettlementResponseV2;
  // Relay-specific fields populated only for sponsored transactions.
  let relayPaymentStatus: RelayPaymentStatus | undefined;
  let relayReceiptId: string | undefined;

  if (isSponsored) {
    log.debug("Routing sponsored transaction to relay", {
      relayUrl,
    });

    const relayBody = JSON.stringify({
      transaction: paymentPayload.payload.transaction,
      maxTimeoutSeconds: 15,
      settle: {
        expectedRecipient: recipientStxAddress,
        minAmount: paymentRequirements.amount,
        tokenType: "sBTC",
      },
    });

    /** Perform one relay call and return the Response. */
    const callRelay = () =>
      fetch(`${relayUrl}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: relayBody,
        signal: AbortSignal.timeout(RELAY_SETTLE_TIMEOUT_MS),
      });

    try {
      let relayResponse = await callRelay();

      // Handle retryable relay errors (e.g. NONCE_CONFLICT) with a single immediate retry.
      // The relay is idempotent for the same tx hex within 5 minutes — no sleep needed.
      if (!relayResponse.ok && relayResponse.status === 409) {
        const errorBody = await relayResponse.text();
        let relayError: { code?: string; retryable?: boolean; retryAfter?: number } = {};
        try {
          relayError = JSON.parse(errorBody);
        } catch {
          // Non-JSON body — treat as non-retryable
        }

        if (relayError.retryable && RELAY_RETRYABLE_CODES.has(relayError.code ?? "")) {
          log.warn("Relay returned retryable nonce error, retrying immediately (idempotent tx hex)", {
            code: relayError.code,
            retryAfter: relayError.retryAfter,
          });
          relayResponse = await callRelay();
        }

        // If still not ok after retry (or was non-retryable), return structured error.
        if (!relayResponse.ok) {
          // After retry: read the new response body. For non-retryable 409s,
          // reuse the already-consumed errorBody instead of reading twice.
          let finalErrorBody = errorBody;
          let finalRelayError = relayError;
          if (relayError.retryable) {
            finalErrorBody = await relayResponse.text();
            try {
              finalRelayError = JSON.parse(finalErrorBody);
            } catch {
              // Non-JSON — use raw text
            }
          }
          const mappedCode = mapRelayErrorCode(finalRelayError.code, relayResponse.status);
          log.error("Sponsor relay failed", {
            status: relayResponse.status,
            code: finalRelayError.code,
            mappedCode,
            error: finalErrorBody,
          });
          return {
            success: false,
            error: finalErrorBody,
            errorCode: mappedCode,
            ...(finalRelayError.retryAfter != null && { retryAfterSeconds: finalRelayError.retryAfter }),
          };
        }
      } else if (!relayResponse.ok) {
        const errorText = await relayResponse.text();
        let relayErrorParsed: { code?: string; retryable?: boolean; retryAfter?: number } = {};
        try {
          relayErrorParsed = JSON.parse(errorText);
        } catch {
          // Non-JSON body
        }
        const mappedCode = mapRelayErrorCode(relayErrorParsed.code, relayResponse.status);
        log.error("Sponsor relay failed", {
          status: relayResponse.status,
          code: relayErrorParsed.code,
          mappedCode,
          error: errorText,
        });
        return {
          success: false,
          error: errorText,
          errorCode: mappedCode,
          ...(relayErrorParsed.retryAfter != null && { retryAfterSeconds: relayErrorParsed.retryAfter }),
        };
      }

      // Map relay response to SettlementResponseV2 format.
      // Relay returns {success, txid, receiptId, settlement: {status, sender, recipient, amount, ...}}
      // settlement.status can be "confirmed" or "pending" (pending = relay timed out, tx was broadcast).
      // SettlementResponseV2 expects {success, transaction, payer, network}.
      const relayData = (await relayResponse.json()) as {
        success: boolean;
        txid?: string;
        receiptId?: string;
        settlement?: { status?: string; sender?: string; recipient?: string; amount?: string };
      };

      // Treat "pending" as success — the tx was broadcast even if settlement hasn't confirmed.
      const relaySuccess = relayData.success === true;
      relayPaymentStatus = (relayData.settlement?.status === "pending" ? "pending" : "confirmed");
      relayReceiptId = relayData.receiptId;

      settleResult = {
        success: relaySuccess,
        transaction: relayData.txid || "",
        payer: relayData.settlement?.sender || "",
        network: networkCAIP2,
      };
      log.debug("Sponsor relay result", { relayData, settleResult, relayPaymentStatus });
    } catch (error) {
      log.error("Sponsor relay exception", { error: String(error) });
      return {
        success: false,
        error: `Sponsor relay error: ${String(error)}`,
        errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
      };
    }
  } else {
    log.debug("Settling non-sponsored transaction via relay", {
      relayUrl,
    });

    const verifier = new X402PaymentVerifier(relayUrl);

    try {
      settleResult = await verifier.settle(paymentPayload, {
        paymentRequirements,
      });
      log.debug("Relay settle result", { settleResult });
    } catch (error) {
      const errorStr = String(error);
      // Try to extract a structured relay code from the thrown error message.
      // Relay errors often embed JSON like: {"code":"BROADCAST_FAILED",...}
      let embeddedCode: string | undefined;
      let embeddedRetryAfter: number | undefined;
      try {
        const jsonMatch = errorStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { code?: string; retryAfter?: number };
          embeddedCode = parsed.code;
          embeddedRetryAfter = parsed.retryAfter;
        }
      } catch {
        // Ignore parse failure — fall back to generic code
      }
      // Reuse the shared mapping function; treat thrown exceptions as 500 (server error).
      const mappedCode = mapRelayErrorCode(embeddedCode, 500);
      log.error("Relay settlement exception", {
        error: errorStr,
        embeddedCode,
        mappedCode,
      });
      return {
        success: false,
        error: `Payment settlement error: ${errorStr}`,
        errorCode: mappedCode,
        ...(embeddedRetryAfter != null && { retryAfterSeconds: embeddedRetryAfter }),
      };
    }
  }

  // Check settlement success
  if (!settleResult.success) {
    log.error("Payment settlement failed", {
      errorReason: settleResult.errorReason,
    });
    return {
      success: false,
      error: settleResult.errorReason || "Payment settlement failed",
      errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
      settleResult,
    };
  }

  // Extract payer address and transaction ID
  const payerStxAddress = settleResult.payer;
  const paymentTxid = settleResult.transaction;

  if (!payerStxAddress) {
    log.error("Settlement succeeded but no payer address");
    return {
      success: false,
      error: "Could not identify payer from payment",
      errorCode: X402_ERROR_CODES.SENDER_MISMATCH,
      settleResult,
    };
  }

  log.info("Inbox payment verified", {
    payerStxAddress,
    paymentTxid,
    recipientStxAddress,
    paymentStatus: relayPaymentStatus,
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid,
    settleResult,
    ...(relayPaymentStatus && { paymentStatus: relayPaymentStatus }),
    ...(relayReceiptId && { receiptId: relayReceiptId }),
  };
}

/**
 * Verify a confirmed on-chain txid as payment proof for inbox message recovery.
 *
 * Recovery path for when x402 settlement times out but the sBTC transfer
 * succeeded on-chain. Validates the tx is a confirmed sBTC SIP-010 transfer
 * with sufficient amount to the expected recipient.
 */
export async function verifyTxidPayment(
  txid: string,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  logger?: Logger,
  kv?: KVNamespace,
  hiroApiKey?: string
): Promise<InboxPaymentVerification> {
  const log = logger || NOOP_LOGGER;

  // Normalize txid: ensure 0x prefix for Stacks API
  const normalizedTxid = txid.startsWith("0x") ? txid.slice(2) : txid;
  const fullTxid = `0x${normalizedTxid}`;

  const apiBase =
    network === "mainnet"
      ? "https://api.hiro.so"
      : "https://api.testnet.hiro.so";

  log.info("Verifying txid payment recovery", {
    txid: fullTxid,
    recipientStxAddress,
    network,
  });

  const pendingCacheKey = `inbox:pending-txid:${normalizedTxid}`;
  let txData: StacksTxData;

  // 1. Confirmed transactions are immutable -- check positive cache first
  const cachedTx = await getCachedTransaction(normalizedTxid, kv) as StacksTxData | null;
  if (cachedTx) {
    log.info("Txid verification: cache hit", { txid: fullTxid });
    txData = cachedTx;
  } else {
    // 2. Negative cache: if this txid was recently checked and found unconfirmed, skip the API call.
    if (kv) {
      const pendingEntry = await kv.get(pendingCacheKey);
      if (pendingEntry) {
        log.info("Txid verification: pending cache hit, skipping API call", { txid: fullTxid });
        return {
          success: false,
          error: "Transaction is not yet confirmed. Check back in a few minutes.",
          errorCode: "TXID_PENDING",
        };
      }
    }

    // 3. Fetch from API
    try {
      const response = await stacksApiFetch(`${apiBase}/extended/v1/tx/${fullTxid}`, {
        method: "GET",
        headers: buildHiroHeaders(hiroApiKey),
      });
      if (!response.ok) {
        if (response.status === 404) {
          // Cache the negative result to prevent repeated lookups for the same unconfirmed txid.
          // Value is unused — only existence matters. TTL handles expiry.
          if (kv) {
            try {
              await kv.put(pendingCacheKey, "1", { expirationTtl: 300 });
            } catch (err) {
              log.warn("[verifyTxidPayment] KV pending cache write failed", { error: String(err), txid: fullTxid });
            }
          }
          return {
            success: false,
            error: "Transaction not found. It may not be confirmed yet.",
            errorCode: "TXID_NOT_FOUND",
          };
        }
        return {
          success: false,
          error: `Stacks API error: ${response.status}`,
          errorCode: "API_ERROR",
        };
      }
      txData = (await response.json()) as StacksTxData;
    } catch (error) {
      log.error("Failed to fetch transaction", { error: String(error) });
      return {
        success: false,
        error: `Failed to verify transaction: ${String(error)}`,
        errorCode: "API_ERROR",
      };
    }
  }

  // Require confirmed, successful transaction
  if (txData.tx_status !== "success") {
    log.warn("Transaction not successful", { status: txData.tx_status });
    // Cache the pending/failed state to prevent redundant API calls.
    // Value is unused — only existence matters. TTL handles expiry.
    if (kv) {
      try {
        await kv.put(pendingCacheKey, "1", { expirationTtl: 300 });
      } catch (err) {
        log.warn("[verifyTxidPayment] KV pending cache write failed", { error: String(err), txid: fullTxid });
      }
    }
    return {
      success: false,
      error: `Transaction status is "${txData.tx_status}", expected "success"`,
      errorCode: "TX_NOT_CONFIRMED",
    };
  }

  // Fire-and-forget cache write for confirmed transactions
  if (!cachedTx) {
    setCachedTransaction(normalizedTxid, txData, kv).catch((err) => {
      console.warn("[verifyTxidPayment] KV cache write failed:", String(err));
    });
  }

  // Require contract call (not a token transfer or other tx type)
  if (txData.tx_type !== "contract_call" || !txData.contract_call) {
    return {
      success: false,
      error: "Transaction is not a contract call",
      errorCode: "INVALID_TX_TYPE",
    };
  }

  // Verify the call targets the sBTC token contract's transfer function
  const sbtcContract = SBTC_CONTRACTS[network];
  const expectedContractId = `${sbtcContract.address}.${sbtcContract.name}`;

  if (txData.contract_call.contract_id !== expectedContractId) {
    return {
      success: false,
      error: `Transaction is not an sBTC transfer (contract: ${txData.contract_call.contract_id})`,
      errorCode: "NOT_SBTC_TRANSFER",
    };
  }

  if (txData.contract_call.function_name !== "transfer") {
    return {
      success: false,
      error: `Unexpected function: ${txData.contract_call.function_name}`,
      errorCode: "NOT_SBTC_TRANSFER",
    };
  }

  // Parse SIP-010 transfer args: (amount uint, sender principal, recipient principal, memo (optional buff))
  const args = txData.contract_call.function_args;
  if (!args || args.length < 3) {
    return {
      success: false,
      error: "Cannot parse transfer arguments",
      errorCode: "INVALID_TX_ARGS",
    };
  }

  const amountArg = args.find((a) => a.name === "amount");
  const recipientArg = args.find((a) => a.name === "recipient");

  if (!amountArg || !recipientArg) {
    return {
      success: false,
      error: "Missing amount or recipient in transfer args",
      errorCode: "INVALID_TX_ARGS",
    };
  }

  // Parse Clarity uint repr (e.g., "u100")
  const amountMatch = amountArg.repr.match(/^u(\d+)$/);
  if (!amountMatch) {
    return {
      success: false,
      error: `Cannot parse amount: ${amountArg.repr}`,
      errorCode: "INVALID_TX_ARGS",
    };
  }
  const transferAmount = parseInt(amountMatch[1], 10);

  if (transferAmount < INBOX_PRICE_SATS) {
    return {
      success: false,
      error: `Transfer amount ${transferAmount} sats is below minimum ${INBOX_PRICE_SATS} sats`,
      errorCode: "INSUFFICIENT_AMOUNT",
    };
  }

  // Strip Clarity principal quote prefix ('SP... -> SP...)
  const recipientAddress = recipientArg.repr.replace(/^'/, "");
  if (recipientAddress !== recipientStxAddress) {
    return {
      success: false,
      error: `Transfer recipient ${recipientAddress} does not match expected ${recipientStxAddress}`,
      errorCode: "RECIPIENT_MISMATCH",
    };
  }

  const payerStxAddress = txData.sender_address;

  log.info("Txid payment verified", {
    txid: fullTxid,
    payerStxAddress,
    transferAmount,
    recipientStxAddress,
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid: normalizedTxid,
  };
}
