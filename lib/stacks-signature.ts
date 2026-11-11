import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import { hashMessage, verifyMessageSignatureRsv } from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { stripHexPrefix } from "@/lib/validation/signature";

/**
 * Verify a Stacks RSV message signature and recover the signer.
 *
 * Accepts the signature with or without a leading `0x` (the MCP
 * `stacks_sign_message` tool returns it prefixed) and ignores surrounding
 * whitespace. Throws if the signature cannot be parsed, so callers keep
 * their existing try/catch handling.
 *
 * `address` is the security check, not `valid`. The public key is recovered
 * from this signature and message, so any parseable signature verifies
 * against it: a signature over a different message just recovers a
 * different key. Callers MUST compare `address` with the address they
 * expect (or, at registration, treat it as the agent's identity).
 */
export function verifyStacksMessageSignature(
  rawSignature: string,
  message: string
): { valid: boolean; address: string; publicKey: string } {
  const signature = stripHexPrefix(rawSignature.trim());
  const messageHashHex = bytesToHex(hashMessage(message));

  const publicKey = publicKeyFromSignatureRsv(messageHashHex, signature);
  const address = getAddressFromPublicKey(publicKey, "mainnet");
  const valid = verifyMessageSignatureRsv({ signature, message, publicKey });

  return { valid, address, publicKey };
}
