import { describe, it, expect } from "vitest";
import {
  randomPrivateKey,
  signMessageHashRsv,
  publicKeyFromSignatureRsv,
  getAddressFromPrivateKey,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import { hashMessage } from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { stripHexPrefix } from "../signature";

describe("stripHexPrefix", () => {
  it("drops one leading 0x or 0X and leaves bare hex alone", () => {
    expect(stripHexPrefix("0xabcd")).toBe("abcd");
    expect(stripHexPrefix("0Xabcd")).toBe("abcd");
    expect(stripHexPrefix("abcd")).toBe("abcd");
    expect(stripHexPrefix("")).toBe("");
  });

  it("makes a 0x-prefixed RSV signature (stacks_sign_message output) recover the signer", () => {
    const messageHash = bytesToHex(hashMessage("Bitcoin will be the currency of AIs"));
    const privateKey = randomPrivateKey();
    const bare = signMessageHashRsv({ messageHash, privateKey });
    const expected = getAddressFromPrivateKey(privateKey, "mainnet");

    // The raw 0x form is what /api/register received before this fix.
    expect(() => publicKeyFromSignatureRsv(messageHash, "0x" + bare)).toThrow();

    for (const sig of [bare, "0x" + bare]) {
      const pub = publicKeyFromSignatureRsv(messageHash, stripHexPrefix(sig));
      expect(getAddressFromPublicKey(pub, "mainnet")).toBe(expected);
    }
  });
});
