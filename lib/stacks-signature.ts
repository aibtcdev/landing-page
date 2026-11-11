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
 * `stacks_sign_message` tool returns it prefixed). Throws if the signature
 * cannot be parsed, so callers keep their existing try/catch handling.
 */
export function verifyStacksMessageSignature(
  rawSignature: string,
  message: string
): { valid: boolean; address: string; publicKey: string } {
  const signature = stripHexPrefix(rawSignature);
  const messageHashHex = bytesToHex(hashMessage(message));

  const publicKey = publicKeyFromSignatureRsv(messageHashHex, signature);
  const address = getAddressFromPublicKey(publicKey, "mainnet");
  const valid = verifyMessageSignatureRsv({ signature, message, publicKey });

  return { valid, address, publicKey };
}
