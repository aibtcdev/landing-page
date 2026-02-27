import { bech32 } from "@scure/base";

/**
 * Validate a raw Nostr public key in 64-char lowercase hex format.
 *
 * Nostr uses x-only pubkeys — 32-byte secp256k1 x-coordinates represented
 * as 64 lowercase hex characters. This function checks only the format,
 * not whether the point is on the curve.
 *
 * @param hex - Candidate pubkey string
 * @returns true if valid 64-char lowercase hex, false otherwise
 */
export function validateNostrPubkey(hex: string): boolean {
  if (!hex || typeof hex !== "string") return false;
  return /^[0-9a-f]{64}$/.test(hex);
}

/**
 * Encode a raw 64-char hex x-only pubkey as an npub1... bech32 string (NIP-19).
 *
 * @param hex - 64-char lowercase hex x-only pubkey
 * @returns npub1... string, or null if the input is invalid
 */
export function encodeNpub(hex: string): string | null {
  if (!validateNostrPubkey(hex)) return null;

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  const words = bech32.toWords(bytes);
  return bech32.encode("npub", words, 1023);
}

/**
 * Derive a Nostr npub from a compressed BTC public key.
 *
 * Nostr uses x-only pubkeys (32 bytes) encoded as bech32 with "npub" prefix.
 * A compressed BTC pubkey is 33 bytes (02/03 prefix + 32 bytes x-coordinate).
 * We drop the prefix byte to get the x-only key, then call encodeNpub().
 *
 * @param btcPublicKey - Compressed public key as hex (66 chars, starts with 02 or 03)
 * @returns npub string, or null if the key is invalid
 */
export function deriveNpub(btcPublicKey: string): string | null {
  if (!btcPublicKey || btcPublicKey.length !== 66) return null;

  const prefix = btcPublicKey.slice(0, 2);
  if (prefix !== "02" && prefix !== "03") return null;

  // x-only pubkey: drop the 02/03 prefix
  const xOnlyHex = btcPublicKey.slice(2);
  return encodeNpub(xOnlyHex);
}
