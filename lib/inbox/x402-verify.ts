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
import type { Logger } from "../logging";

/** No-op logger used when no logger is provided. */
const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

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
  errorCode?: string;
  settleResult?: SettlementResponseV2;
}

/**
 * Verify x402 payment for an inbox message.
 *
 * Validates that:
 * 1. Payment is in sBTC (rejects STX, USDCx)
 * 2. Payment amount meets minimum (INBOX_PRICE_SATS)
 * 3. Payment recipient is the intended recipient agent
 * 4. Payment is not expired or already used
 *
 * For sponsored transactions:
 * - Relays to x402-relay.aibtc.com for settlement
 * - Sponsor pays the transaction fee
 *
 * For non-sponsored transactions:
 * - Settles via x402-relay.aibtc.com
 * - Sender pays the transaction fee
 *
 * @param paymentPayload - x402 v2 payment payload from payment-signature header (base64-decoded)
 * @param recipientStxAddress - Recipient agent's STX address (from AgentRecord)
 * @param network - Stacks network (from env.X402_NETWORK or default "mainnet")
 * @param relayUrl - x402 relay URL for all settlement (from env.X402_RELAY_URL or default)
 * @param logger - Logger instance for observability
 * @returns Verification result with payer address and message ID
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

  if (isSponsored) {
    log.debug("Routing sponsored transaction to relay", {
      relayUrl,
    });

    try {
      const relayResponse = await fetch(`${relayUrl}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction: paymentPayload.payload.transaction,
          settle: {
            expectedRecipient: recipientStxAddress,
            minAmount: paymentRequirements.amount,
            tokenType: "sBTC",
          },
        }),
        signal: AbortSignal.timeout(RELAY_SETTLE_TIMEOUT_MS),
      });

      if (!relayResponse.ok) {
        const errorText = await relayResponse.text();
        log.error("Sponsor relay failed", {
          status: relayResponse.status,
          error: errorText,
        });
        return {
          success: false,
          error: `Sponsor relay failed: ${errorText}`,
          errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
        };
      }

      // Map relay response to SettlementResponseV2 format.
      // Relay returns {success, txid, settlement: {sender, recipient, amount, ...}}
      // SettlementResponseV2 expects {success, transaction, payer, network}.
      const relayData = (await relayResponse.json()) as {
        success: boolean;
        txid?: string;
        settlement?: { sender?: string };
      };
      settleResult = {
        success: relayData.success,
        transaction: relayData.txid || "",
        payer: relayData.settlement?.sender || "",
        network: networkCAIP2,
      };
      log.debug("Sponsor relay result", { relayData, settleResult });
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
      log.error("Relay settlement exception", {
        error: String(error),
      });
      return {
        success: false,
        error: `Payment settlement error: ${String(error)}`,
        errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
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
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid,
    settleResult,
  };
}

/**
 * Verify a confirmed on-chain txid as payment proof for inbox message recovery.
 *
 * This is a recovery path for when x402 payment settlement times out but the
 * sBTC transfer succeeded on-chain. The sender can resubmit the message with
 * the confirmed txid to prove payment was made.
 *
 * Validates that:
 * 1. Transaction exists and is confirmed (success status)
 * 2. Transaction is an sBTC SIP-010 transfer (contract-call to sbtc-token.transfer)
 * 3. Transfer amount >= INBOX_PRICE_SATS (100 sats)
 * 4. Recipient matches the inbox address's STX address
 * 5. Txid has not been redeemed for a previous message (checked by caller via KV)
 *
 * @param txid - Confirmed Stacks transaction ID (hex, with or without 0x prefix)
 * @param recipientStxAddress - Expected recipient's STX address
 * @param network - Stacks network ("mainnet" | "testnet")
 * @param logger - Optional logger
 * @returns Verification result with payer address
 */
export async function verifyTxidPayment(
  txid: string,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  logger?: Logger
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

  // Fetch and validate transaction from Stacks API
  let txData: {
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
  };

  try {
    const response = await fetch(`${apiBase}/extended/v1/tx/${fullTxid}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 404) {
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
    txData = await response.json();
  } catch (error) {
    log.error("Failed to fetch transaction", { error: String(error) });
    return {
      success: false,
      error: `Failed to verify transaction: ${String(error)}`,
      errorCode: "API_ERROR",
    };
  }

  // Require confirmed, successful transaction
  if (txData.tx_status !== "success") {
    log.warn("Transaction not successful", { status: txData.tx_status });
    return {
      success: false,
      error: `Transaction status is "${txData.tx_status}", expected "success"`,
      errorCode: "TX_NOT_CONFIRMED",
    };
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
