import { describe, it, expect } from "vitest";
import { hashAddress, createSeededRng, selectIndex } from "../hash";

describe("hashAddress", () => {
  it("returns consistent results for the same input", () => {
    const address = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
    const hash1 = hashAddress(address);
    const hash2 = hashAddress(address);
    expect(hash1).toBe(hash2);
  });

  it("returns different results for different inputs", () => {
    const hash1 = hashAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
    const hash2 = hashAddress("SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE");
    expect(hash1).not.toBe(hash2);
  });

  it("returns unsigned 32-bit integers", () => {
    const addresses = [
      "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "",
      "a",
    ];
    for (const addr of addresses) {
      const hash = hashAddress(addr);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(hash)).toBe(true);
    }
  });

  it("handles empty string", () => {
    const hash = hashAddress("");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("handles very long strings", () => {
    const longAddress = "SP" + "A".repeat(10000);
    const hash = hashAddress(longAddress);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("handles special characters and unicode", () => {
    const specialInputs = [
      "SP!@#$%^&*()",
      "\u0000\u0001\u0002",
      "\u{1F600}\u{1F680}\u{1F4A1}",
      "   ",
      "\n\t\r",
    ];
    for (const input of specialInputs) {
      const hash = hashAddress(input);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("shows good avalanche: similar inputs produce very different hashes", () => {
    // Changing a single character should produce a very different hash
    const hash1 = hashAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
    const hash2 = hashAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ8");

    // XOR the hashes and count differing bits
    const xor = hash1 ^ hash2;
    let bitsChanged = 0;
    for (let i = 0; i < 32; i++) {
      if ((xor >> i) & 1) bitsChanged++;
    }
    // Good avalanche: at least 25% of bits should differ (8 of 32)
    expect(bitsChanged).toBeGreaterThanOrEqual(8);
  });
});

describe("createSeededRng", () => {
  it("produces deterministic sequences from the same seed", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences from different seeds", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(43);

    const seq1 = Array.from({ length: 5 }, () => rng1());
    const seq2 = Array.from({ length: 5 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it("produces unsigned 32-bit integers", () => {
    const rng = createSeededRng(12345);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("produces varied output (not stuck on one value)", () => {
    const rng = createSeededRng(0);
    const values = new Set(Array.from({ length: 100 }, () => rng()));
    // 100 sequential values should all be unique
    expect(values.size).toBe(100);
  });

  it("works with edge case seeds", () => {
    const edgeSeeds = [0, 1, -1, 0x7fffffff, 0xffffffff];
    for (const seed of edgeSeeds) {
      const rng = createSeededRng(seed);
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("selectIndex", () => {
  it("maps values to valid range [0, length)", () => {
    const testValues = [0, 1, 100, 999, 0xffffffff, 0x7fffffff];
    const lengths = [10, 100, 239, 212, 221];

    for (const val of testValues) {
      for (const len of lengths) {
        const index = selectIndex(val, len);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(len);
        expect(Number.isInteger(index)).toBe(true);
      }
    }
  });

  it("never returns negative values", () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const index = selectIndex(rng(), 239);
      expect(index).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns 0 for input 0", () => {
    expect(selectIndex(0, 100)).toBe(0);
  });

  it("handles length of 1", () => {
    expect(selectIndex(42, 1)).toBe(0);
    expect(selectIndex(999, 1)).toBe(0);
  });
});
