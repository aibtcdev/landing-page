/**
 * Types for Sponsor Key Provisioning
 *
 * Used to provision free-tier sponsor API keys via the x402 sponsor relay.
 */

/**
 * Result of sponsor key provisioning attempt.
 *
 * Success case includes the API key string.
 * Failure case includes error message and optional HTTP status code.
 */
export interface SponsorKeyResult {
  success: boolean;
  apiKey?: string;
  error?: string;
  status?: number;
}
