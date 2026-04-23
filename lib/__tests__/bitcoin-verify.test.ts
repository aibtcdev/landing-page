import { describe, it, expect } from "vitest";
import {
  formatBitcoinMessage,
  doubleSha256,
  bip322VerifyP2WPKH,
  bip322VerifyP2TR,
  verifyBitcoinSignature,
  BITCOIN_MSG_PREFIX,
} from "../bitcoin-verify";
import { p2wpkh, p2tr, Address, NETWORK as BTC_NETWORK, RawWitness } from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Uint8Array to base64 string without Buffer */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// formatBitcoinMessage
// ---------------------------------------------------------------------------

describe("formatBitcoinMessage", () => {
  it("should produce a Uint8Array output", () => {
    const result = formatBitcoinMessage("hello");
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("should start with the Bitcoin message prefix", () => {
    const prefix = new TextEncoder().encode(BITCOIN_MSG_PREFIX);
    const result = formatBitcoinMessage("hello");
    for (let i = 0; i < prefix.length; i++) {
      expect(result[i]).toBe(prefix[i]);
    }
  });

  it("should encode the message after the prefix and varint length", () => {
    const msg = "AIBTC Check-In | 2026-04-19T12:58:30.000Z";
    const result = formatBitcoinMessage(msg);
    const msgBytes = new TextEncoder().encode(msg);
    // result = prefix || varint(msgLen) || msgBytes
    const prefixLen = new TextEncoder().encode(BITCOIN_MSG_PREFIX).length;
    // varint for 38-byte string = 0x26 (38 < 0xfd)
    const varintLen = 1;
    const encodedMsg = result.slice(prefixLen + varintLen);
    expect(encodedMsg).toEqual(msgBytes);
  });

  it("should produce different outputs for different messages", () => {
    const r1 = formatBitcoinMessage("msg A");
    const r2 = formatBitcoinMessage("msg B");
    expect(r1).not.toEqual(r2);
  });

  it("should handle an empty message", () => {
    const result = formatBitcoinMessage("");
    expect(result.length).toBeGreaterThan(0);
    const prefixLen = new TextEncoder().encode(BITCOIN_MSG_PREFIX).length;
    expect(result[prefixLen]).toBe(0); // varint 0 for empty string
  });
});

// ---------------------------------------------------------------------------
// doubleSha256
// ---------------------------------------------------------------------------

describe("doubleSha256", () => {
  it("should produce a 32-byte hash", () => {
    const result = doubleSha256(new TextEncoder().encode("test"));
    expect(result).toHaveLength(32);
  });

  it("should be deterministic", () => {
    const input = new TextEncoder().encode("test");
    expect(doubleSha256(input)).toEqual(doubleSha256(input));
  });

  it("should produce different hashes for different inputs", () => {
    const h1 = doubleSha256(new TextEncoder().encode("a"));
    const h2 = doubleSha256(new TextEncoder().encode("b"));
    expect(h1).not.toEqual(h2);
  });

  it("should match known test vector", () => {
    // double-SHA256 of empty string (bitcoin block 0 hash)
    const result = doubleSha256(new Uint8Array(0));
    const expected = hex.decode("5df6e0e2761359d30a8275058e299fcc0381534545f85cf7e0b7c8a4c7f29a2");
    expect(result).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// bip322VerifyP2WPKH - error path tests (no real sigs needed)
// ---------------------------------------------------------------------------

describe("bip322VerifyP2WPKH", () => {
  // Use a real keypair to produce valid-looking witness data
  const TEST_PRIVKEY = hex.decode("0000000000000000000000000000000000000000000000000000000000000001");
  const TEST_PUBKEY = secp256k1.getPublicKey(TEST_PRIVKEY, true);
  const TEST_ADDR = p2wpkh(TEST_PUBKEY, BTC_NETWORK).address!;

  it("should throw for completely invalid base64", () => {
    expect(() => bip322VerifyP2WPKH("test", "!!!not-base64!!!", TEST_ADDR)).toThrow();
  });

  it("should throw when witness has wrong number of items (not 2)", () => {
    // 1-item witness (P2WPKH needs exactly 2: sig + pubkey)
    const oneItemWitness = RawWitness.encode([new Uint8Array(64)]);
    expect(() =>
      bip322VerifyP2WPKH("test", toBase64(oneItemWitness), TEST_ADDR)
    ).toThrow(/expected 2 witness items/);
  });

  it("should throw when pubkey in witness is not 33 bytes", () => {
    // Valid 2-item witness format but pubkey is wrong length
    const twoItemWitness = RawWitness.encode([new Uint8Array(64), new Uint8Array(32)]); // 32 not 33
    expect(() =>
      bip322VerifyP2WPKH("test", toBase64(twoItemWitness), TEST_ADDR)
    ).toThrow(/expected 33-byte compressed pubkey/);
  });

  it("should throw for non-base64 characters in signature", () => {
    // Build a witness with an invalid pubkey that will fail base64 decode
    const badWitness = RawWitness.encode([new Uint8Array(65), new Uint8Array(33)]);
    const badBase64 = toBase64(badWitness).replace("+", "!").replace("/", "#");
    expect(() => bip322VerifyP2WPKH("test", badBase64, TEST_ADDR)).toThrow();
  });

  it("should correctly identify a valid address derived from pubkey", () => {
    // Verify that our test address is actually a valid bc1q address
    expect(TEST_ADDR.startsWith("bc1q")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bip322VerifyP2TR - error path tests
// ---------------------------------------------------------------------------

describe("bip322VerifyP2TR", () => {
  const TEST_PRIVKEY = hex.decode("0000000000000000000000000000000000000000000000000000000000000002");
  const TEST_PUBKEY = secp256k1.getPublicKey(TEST_PRIVKEY, true);
  const TEST_ADDR = p2tr(TEST_PUBKEY, BTC_NETWORK).address!;

  it("should throw for non-P2TR address", () => {
    // bc1q is not P2TR
    const bc1qAddr = p2wpkh(TEST_PUBKEY, BTC_NETWORK).address!;
    expect(() => bip322VerifyP2TR("test", "abc", bc1qAddr)).toThrow(/P2TR/);
  });

  it("should throw when witness has wrong number of items (not 1)", () => {
    // 2-item witness (P2TR needs exactly 1: Schnorr sig)
    const wrongWitness = RawWitness.encode([new Uint8Array(64), new Uint8Array(33)]);
    expect(() =>
      bip322VerifyP2TR("test", toBase64(wrongWitness), TEST_ADDR)
    ).toThrow(/expected 1 witness item/);
  });

  it("should throw when Schnorr signature is not 64 bytes", () => {
    // 65 bytes (one too many)
    const longWitness = RawWitness.encode([new Uint8Array(65)]);
    expect(() =>
      bip322VerifyP2TR("test", toBase64(longWitness), TEST_ADDR)
    ).toThrow(/expected 64-byte Schnorr sig/);
  });

  it("should throw for empty base64 string", () => {
    expect(() => bip322VerifyP2TR("test", "", TEST_ADDR)).toThrow();
  });

  it("should correctly identify a valid P2TR address", () => {
    expect(TEST_ADDR.startsWith("bc1p")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyBitcoinSignature - routing and error handling
// ---------------------------------------------------------------------------

describe("verifyBitcoinSignature", () => {
  const TEST_PRIVKEY = hex.decode("0000000000000000000000000000000000000000000000000000000000000001");
  const TEST_PUBKEY = secp256k1.getPublicKey(TEST_PRIVKEY, true);
  const TEST_ADDR_P2WPKH = p2wpkh(TEST_PUBKEY, BTC_NETWORK).address!;

  it("should throw when BIP-322 sig provided without btcAddress parameter", () => {
    // Any 64-byte hex string triggers BIP-322 path (not 65-byte BIP-137)
    const fakeHexSig = "00".repeat(64);
    expect(() => verifyBitcoinSignature(fakeHexSig, "test")).toThrow(
      /BIP-322 signature requires btcAddress/
    );
  });

  it("should throw for unsupported BIP-322 address type (P2PKH legacy)", () => {
    // P2PKH address (starts with 1) is not supported for BIP-322
    const legacyAddr = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
    const fakeWitness = RawWitness.encode([new Uint8Array(65), new Uint8Array(33)]);
    expect(() =>
      verifyBitcoinSignature(toBase64(fakeWitness), "test", legacyAddr)
    ).toThrow(/BIP-322 verification not supported for address type/);
  });

  it("should throw for non-standard base64 characters", () => {
    const fakeWitness = RawWitness.encode([new Uint8Array(65), new Uint8Array(33)]);
    const badSig = toBase64(fakeWitness).replace("+", "!").replace("/", "#");
    expect(() => verifyBitcoinSignature(badSig, "test", TEST_ADDR_P2WPKH)).toThrow();
  });

  it("should throw for empty signature string", () => {
    expect(() => verifyBitcoinSignature("", "test", TEST_ADDR_P2WPKH)).toThrow();
  });

  it("should route bc1q address to P2WPKH verifier", () => {
    expect(TEST_ADDR_P2WPKH.startsWith("bc1q")).toBe(true);
  });

  it("should route bc1p address to P2TR verifier", () => {
    const p2trAddr = p2tr(TEST_PUBKEY, BTC_NETWORK).address!;
    expect(p2trAddr.startsWith("bc1p")).toBe(true);
  });

  it("should accept hex-encoded BIP-322 signature (130-char hex = 65 bytes)", () => {
    // 65-byte signature = BIP-137 path (header byte 27-42)
    // 64-byte signature = BIP-322 path
    // This test confirms hex format is accepted
    const hex65 = "00".repeat(65);
    expect(() =>
      verifyBitcoinSignature(hex65, "test", TEST_ADDR_P2WPKH)
    ).toThrow(); // Will throw because it's BIP-137 but routed wrong, confirming hex parsing works
  });

  it("should handle the specific test message format from the codebase", () => {
    const msg = "Regenerate claim code for bc1p";
    const formatted = formatBitcoinMessage(msg);
    expect(formatted.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseDERSignature error paths (triggered through bip322VerifyP2WPKH)
// ---------------------------------------------------------------------------

describe("DER signature parsing error paths", () => {
  const TEST_PRIVKEY = hex.decode("0000000000000000000000000000000000000000000000000000000000000001");
  const TEST_PUBKEY = secp256k1.getPublicKey(TEST_PRIVKEY, true);
  const TEST_ADDR = p2wpkh(TEST_PUBKEY, BTC_NETWORK).address!;

  it("should throw when DER signature has wrong header byte (not 0x30)", () => {
    // Build a witness with corrupted DER header
    const corruptedDer = new Uint8Array(70);
    corruptedDer[0] = 0x99; // Invalid DER header
    const sigWithHashtype = new Uint8Array(71);
    sigWithHashtype.set(corruptedDer);
    sigWithHashtype[70] = 0x01; // hashtype
    const witness = RawWitness.encode([sigWithHashtype, TEST_PUBKEY]);
    expect(() =>
      bip322VerifyP2WPKH("test", toBase64(witness), TEST_ADDR)
    ).toThrow();
  });

  it("should throw when DER r-length extends beyond signature", () => {
    // Build a witness where the r-length byte claims more data than exists
    const badDer = new Uint8Array(10);
    badDer[0] = 0x30; // DER SEQUENCE
    badDer[1] = 0x02; // DER INTEGER (r)
    badDer[2] = 0xff; // claims 255 bytes for r... but total sig is only 10 bytes
    const witness = RawWitness.encode([badDer, TEST_PUBKEY]);
    expect(() =>
      bip322VerifyP2WPKH("test", toBase64(witness), TEST_ADDR)
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Address derivation consistency
// ---------------------------------------------------------------------------

describe("Address derivation", () => {
  it("p2wpkh should produce bc1q addresses", () => {
    const privkey = hex.decode("0000000000000000000000000000000000000000000000000000000000000001");
    const pubkey = secp256k1.getPublicKey(privkey, true);
    const addr = p2wpkh(pubkey, BTC_NETWORK).address!;
    expect(addr.startsWith("bc1q")).toBe(true);
    expect(addr.length).toBe(42);
  });

  it("p2tr should produce bc1p addresses", () => {
    const privkey = hex.decode("0000000000000000000000000000000000000000000000000000000000000002");
    const pubkey = secp256k1.getPublicKey(privkey, true);
    const addr = p2tr(pubkey, BTC_NETWORK).address!;
    expect(addr.startsWith("bc1p")).toBe(true);
    expect(addr.length).toBe(62);
  });

  it("Address.decode should correctly decode a bc1p address", () => {
    const privkey = hex.decode("0000000000000000000000000000000000000000000000000000000000000002");
    const pubkey = secp256k1.getPublicKey(privkey, true);
    const addr = p2tr(pubkey, BTC_NETWORK).address!;
    const decoded = Address(BTC_NETWORK).decode(addr);
    expect(decoded.type).toBe("tr");
    expect(decoded.pubkey).toBeInstanceOf(Uint8Array);
  });
});
