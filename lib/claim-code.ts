/**
 * Generate a 6-character alphanumeric claim code.
 * Uses crypto-random values, excludes ambiguous characters (0, O, I, l, 1).
 */
export function generateClaimCode(): string {
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
