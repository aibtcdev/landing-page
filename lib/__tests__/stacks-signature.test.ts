import { describe, it, expect } from "vitest";
import {
  randomPrivateKey,
  signMessageHashRsv,
  publicKeyFromSignatureRsv,
  getAddressFromPrivateKey,
} from "@stacks/transactions";
import { hashMessage } from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { stripHexPrefix } from "../validation/signature";
import { verifyStacksMessageSignature } from "../stacks-signature";

const MESSAGE = "Bitcoin will be the currency of AIs";

function sign(message: string) {
  const privateKey = randomPrivateKey();
  const messageHash = bytesToHex(hashMessage(message));
  return {
    messageHash,
    signature: signMessageHashRsv({ messageHash, privateKey }),
    address: getAddressFromPrivateKey(privateKey, "mainnet"),
  };
}

describe("stripHexPrefix", () => {
  it("drops one leading 0x or 0X and leaves bare hex alone", () => {
    expect(stripHexPrefix("0xabcd")).toBe("abcd");
    expect(stripHexPrefix("0Xabcd")).toBe("abcd");
    expect(stripHexPrefix("abcd")).toBe("abcd");
    expect(stripHexPrefix("")).toBe("");
  });
});

describe("verifyStacksMessageSignature", () => {
  it("accepts bare, 0x-prefixed (stacks_sign_message) and whitespace-padded signatures", () => {
    const { messageHash, signature, address } = sign(MESSAGE);

    // The library itself rejects the 0x form, so the helper must strip it.
    expect(() => publicKeyFromSignatureRsv(messageHash, "0x" + signature)).toThrow();

    for (const sig of [signature, "0x" + signature, ` 0x${signature}\n`]) {
      const result = verifyStacksMessageSignature(sig, MESSAGE);
      expect(result.valid).toBe(true);
      expect(result.address).toBe(address);
    }
  });

  it("does not attribute a signature over another message to the signer", () => {
    const { signature, address } = sign(MESSAGE);
    const result = verifyStacksMessageSignature("0x" + signature, "a different message");
    // valid is still true (the key is recovered from this signature), which is
    // why callers must compare the recovered address.
    expect(result.valid).toBe(true);
    expect(result.address).not.toBe(address);
  });
});
