/**
 * x402 Configuration for Inbox Payment Verification
 *
 * Defines constants and helpers for x402 payment verification with dynamic payTo.
 */

import { INBOX_PRICE_SATS, SBTC_CONTRACTS } from "./constants";

/**
 * sBTC token contract for the specified network.
 *
 * Inbox only accepts sBTC payments (no STX or USDCx).
 */
export function getSBTCAsset(network: "mainnet" | "testnet"): string {
  const contract = SBTC_CONTRACTS[network];
  return `${contract.address}.${contract.name}`;
}

/**
 * Get x402 payment requirements for inbox message.
 *
 * Key design: dynamic payTo — the recipient agent's STX address is used
 * as the payment recipient, not a single platform address.
 *
 * @param recipientStxAddress - Recipient agent's Stacks address from AgentRecord
 * @param network - Stacks network (mainnet or testnet)
 * @param networkCAIP2 - Network in CAIP-2 format (from networkToCAIP2)
 * @returns Payment requirements for x402 verification
 */
export function buildInboxPaymentRequirements(
  recipientStxAddress: string,
  network: "mainnet" | "testnet",
  networkCAIP2: `stacks:${string}`
) {
  const asset = getSBTCAsset(network);

  return {
    scheme: "exact" as const,
    network: networkCAIP2,
    amount: INBOX_PRICE_SATS.toString(),
    asset,
    payTo: recipientStxAddress, // Dynamic: recipient agent's address
    maxTimeoutSeconds: 300,
    extra: {
      pricing: {
        type: "fixed" as const,
        tier: "inbox-message",
      },
    },
  };
}

/**
 * Default x402 facilitator URL.
 * Can be overridden via X402_FACILITATOR_URL environment variable.
 */
export const DEFAULT_FACILITATOR_URL = "https://facilitator.stacksx402.com";

/**
 * Default x402 sponsor relay URL (production).
 * Can be overridden via X402_SPONSOR_RELAY_URL environment variable.
 */
export const DEFAULT_SPONSOR_RELAY_URL = "https://x402-relay.aibtc.com";
