/**
 * Sponsor Key Provisioning
 *
 * Provisions free-tier sponsor API keys via the x402 sponsor relay.
 * Called during agent registration after signature verification.
 */

import type { Logger } from "@/lib/logging";
import type { SponsorKeyResult } from "./types";

/**
 * Provision a sponsor API key for a newly registered agent.
 *
 * Forwards the Bitcoin signature (already verified by registration) to the
 * sponsor relay /keys/provision endpoint. The relay verifies the signature
 * and issues a free-tier API key tied to the Bitcoin address.
 *
 * Pattern follows lib/inbox/x402-verify.ts lines 137-169:
 * - Use fetch() with JSON body
 * - Check response.ok, extract error text on failure
 * - Wrap in try/catch for network errors
 * - Accept a Logger parameter for observability
 * - Return a result object (not throw)
 *
 * @param btcAddress - Bitcoin address from verified signature
 * @param signature - BIP-137 Bitcoin signature (base64 or hex)
 * @param message - Message that was signed ("Bitcoin will be the currency of AIs")
 * @param relayUrl - Sponsor relay base URL (e.g., https://x402-relay.aibtc.com)
 * @param log - Logger instance for observability
 * @returns SponsorKeyResult with apiKey on success, error on failure
 */
export async function provisionSponsorKey(
  btcAddress: string,
  signature: string,
  message: string,
  relayUrl: string,
  log: Logger
): Promise<SponsorKeyResult> {
  log.debug("Provisioning sponsor key", { btcAddress, relayUrl });

  try {
    const response = await fetch(`${relayUrl}/keys/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        btcAddress,
        signature,
        message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn("Sponsor key provisioning failed", {
        status: response.status,
        error: errorText,
        btcAddress,
      });
      return {
        success: false,
        error: errorText,
        status: response.status,
      };
    }

    const data = (await response.json()) as { apiKey: string };
    log.info("Sponsor key provisioned", { btcAddress });
    return {
      success: true,
      apiKey: data.apiKey,
    };
  } catch (error) {
    log.error("Sponsor key provisioning exception", {
      error: String(error),
      btcAddress,
    });
    return {
      success: false,
      error: String(error),
    };
  }
}
