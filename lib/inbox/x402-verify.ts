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
import {
  buildInboxPaymentRequirements,
  getSBTCAsset,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_SPONSOR_RELAY_URL,
} from "./x402-config";
import type { Logger } from "../logging";

/**
 * Result of x402 payment verification for inbox messages.
 */
export interface InboxPaymentVerification {
  success: boolean;
  payerStxAddress?: string;
  paymentTxid?: string;
  messageId?: string; // Extracted from payment memo (resource field)
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
 * - Settles via facilitator.stacksx402.com
 * - Sender pays the transaction fee
 *
 * @param paymentPayload - x402 v2 payment payload from payment-signature header (base64-decoded)
 * @param recipientStxAddress - Recipient agent's STX address (from AgentRecord)
 * @param network - Stacks network (from env.X402_NETWORK or default "mainnet")
 * @param facilitatorUrl - x402 facilitator URL (from env.X402_FACILITATOR_URL or default)
 * @param sponsorRelayUrl - x402 sponsor relay URL (from env.X402_SPONSOR_RELAY_URL or default)
 * @param logger - Logger instance for observability
 * @returns Verification result with payer address and message ID
 */
export async function verifyInboxPayment(
  paymentPayload: PaymentPayloadV2,
  recipientStxAddress: string,
  network: "mainnet" | "testnet" = "mainnet",
  facilitatorUrl: string = DEFAULT_FACILITATOR_URL,
  sponsorRelayUrl: string = DEFAULT_SPONSOR_RELAY_URL,
  logger?: Logger
): Promise<InboxPaymentVerification> {
  const log = logger || {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

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

  // Extract message ID from payment resource (if present in v2)
  let messageId: string | undefined;
  if (paymentPayload.resource?.url) {
    // In v2, message ID might be in resource.url
    messageId = paymentPayload.resource.url;
    log.debug("Extracted resource from payload", { messageId });
  }

  // Determine if transaction is sponsored
  const isSponsored = paymentPayload.payload.transaction.startsWith("0x80000005");

  // Route sponsored transactions to relay, non-sponsored to facilitator
  let settleResult: SettlementResponseV2;

  if (isSponsored) {
    log.debug("Routing sponsored transaction to relay", {
      relayUrl: sponsorRelayUrl,
    });

    try {
      const relayResponse = await fetch(`${sponsorRelayUrl}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHex: paymentPayload.payload.transaction,
          paymentRequirements,
        }),
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

      settleResult = await relayResponse.json();
      log.debug("Sponsor relay result", { settleResult });
    } catch (error) {
      log.error("Sponsor relay exception", { error: String(error) });
      return {
        success: false,
        error: `Sponsor relay error: ${String(error)}`,
        errorCode: X402_ERROR_CODES.UNEXPECTED_SETTLE_ERROR,
      };
    }
  } else {
    log.debug("Settling non-sponsored transaction via facilitator", {
      facilitatorUrl,
    });

    const verifier = new X402PaymentVerifier(facilitatorUrl);

    try {
      settleResult = await verifier.settle(paymentPayload, {
        paymentRequirements,
      });
      log.debug("Facilitator settle result", { settleResult });
    } catch (error) {
      log.error("Facilitator settlement exception", {
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
    messageId,
    recipientStxAddress,
  });

  return {
    success: true,
    payerStxAddress,
    paymentTxid,
    messageId,
    settleResult,
  };
}
