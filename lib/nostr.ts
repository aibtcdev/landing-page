import { bech32 } from "@scure/base";

/**
 * Derive a Nostr npub from a compressed BTC public key.
 *
 * Nostr uses x-only pubkeys (32 bytes) encoded as bech32 with "npub" prefix.
 * A compressed BTC pubkey is 33 bytes (02/03 prefix + 32 bytes x-coordinate).
 * We drop the prefix byte to get the x-only key.
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
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(xOnlyHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Encode as bech32 with "npub" prefix (NIP-19)
  const words = bech32.toWords(bytes);
  return bech32.encode("npub", words, 1023);
}
