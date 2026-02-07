import { hashSha256Sync } from "@stacks/encryption";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";

export const BITCOIN_MSG_PREFIX = "\x18Bitcoin Signed Message:\n";
export const BTC_NETWORK = btc.NETWORK;

function encodeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error("Message too long");
}

export function formatBitcoinMessage(message: string): Uint8Array {
  const prefixBytes = new TextEncoder().encode(BITCOIN_MSG_PREFIX);
  const messageBytes = new TextEncoder().encode(message);
  const lengthBytes = encodeVarInt(messageBytes.length);
  const result = new Uint8Array(
    prefixBytes.length + lengthBytes.length + messageBytes.length
  );
  result.set(prefixBytes, 0);
  result.set(lengthBytes, prefixBytes.length);
  result.set(messageBytes, prefixBytes.length + lengthBytes.length);
  return result;
}

export function doubleSha256(data: Uint8Array): Uint8Array {
  return hashSha256Sync(hashSha256Sync(data));
}

export function getRecoveryIdFromHeader(header: number): number {
  if (header >= 27 && header <= 30) return header - 27;
  if (header >= 31 && header <= 34) return header - 31;
  if (header >= 35 && header <= 38) return header - 35;
  if (header >= 39 && header <= 42) return header - 39;
  throw new Error(`Invalid BIP-137 header byte: ${header}`);
}

/**
 * Verify a BIP-137 Bitcoin signature against a given message.
 * Returns the recovered address and public key.
 */
export function verifyBitcoinSignature(
  signature: string,
  message: string
): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  let sigBytes: Uint8Array;
  if (signature.length === 130 && /^[0-9a-fA-F]+$/.test(signature)) {
    sigBytes = hex.decode(signature);
  } else {
    sigBytes = Uint8Array.from(Buffer.from(signature, "base64"));
  }

  if (sigBytes.length !== 65) {
    throw new Error(`Invalid signature length: ${sigBytes.length}`);
  }

  const header = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);
  const recoveryId = getRecoveryIdFromHeader(header);

  const formattedMsg = formatBitcoinMessage(message);
  const msgHash = doubleSha256(formattedMsg);

  const r = BigInt("0x" + hex.encode(rBytes));
  const s = BigInt("0x" + hex.encode(sBytes));

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(recoveryId);
  const recoveredPoint = sig.recoverPublicKey(msgHash);
  const recoveredPubKey = recoveredPoint.toBytes(true);

  const valid = secp256k1.verify(
    sig.toBytes("compact"),
    msgHash,
    recoveredPubKey,
    { prehash: false }
  );

  const p2wpkh = btc.p2wpkh(recoveredPubKey, BTC_NETWORK);

  return {
    valid,
    address: p2wpkh.address!,
    publicKey: hex.encode(recoveredPubKey),
  };
}
