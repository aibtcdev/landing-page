/**
 * Sponsor Key Provisioning
 *
 * Provisions free-tier sponsor API keys via the x402 sponsor relay.
 * Called during agent registration after signature verification.
 */

import type { Logger } from "@/lib/logging";
import type { SponsorKeyResult } from "./types";
import { SPONSOR_RELAY_TIMEOUT_MS } from "./constants";

/**
 * Provision a sponsor API key for a newly registered agent.
 *
 * Forwards the Bitcoin signature (already verified by registration) to the
 * sponsor relay /keys/provision endpoint. The relay verifies the signature
 * and issues a free-tier API key tied to the Bitcoin address.
 *
 * Follows the same fetch + error handling pattern as verifyInboxPayment():
 * fetch with JSON body, check response.ok, wrap in try/catch, return result object.
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
      body: JSON.stringify({ btcAddress, signature, message }),
      signal: AbortSignal.timeout(SPONSOR_RELAY_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn("Sponsor key provisioning failed", {
        status: response.status,
        error: errorText,
        btcAddress,
      });
      return { success: false, error: errorText, status: response.status };
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!data || typeof data.apiKey !== "string") {
      log.warn("Sponsor relay returned unexpected response shape", {
        btcAddress,
      });
      return { success: false, error: "Unexpected response from sponsor relay" };
    }

    log.info("Sponsor key provisioned", { btcAddress });
    return { success: true, apiKey: data.apiKey };
  } catch (error) {
    log.error("Sponsor key provisioning exception", {
      error: String(error),
      btcAddress,
    });
    return { success: false, error: String(error) };
  }
}
