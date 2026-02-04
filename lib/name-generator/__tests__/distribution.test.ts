import { describe, it, expect } from "vitest";
import { generateNameDetailed } from "../generator";
import { hashAddress, createSeededRng, selectIndex } from "../hash";
import { ADJECTIVES, NOUNS } from "../word-lists";

describe("distribution", () => {
  // Generate a large sample of names from sequential-like addresses
  const SAMPLE_SIZE = 500;
  const sampleAddresses = Array.from(
    { length: SAMPLE_SIZE },
    (_, i) => `SP${i.toString(16).padStart(40, "0")}`
  );

  it("word indices spread across adjective list (no clustering)", () => {
    const indices = sampleAddresses.map((addr) => {
      const seed = hashAddress(addr);
      const rng = createSeededRng(seed);
      return selectIndex(rng(), ADJECTIVES.length);
    });

    const uniqueIndices = new Set(indices);
    // With 500 samples over ~239 adjectives, we expect good coverage
    // At least 40% of the list should be hit
    const coverageRatio = uniqueIndices.size / ADJECTIVES.length;
    expect(coverageRatio).toBeGreaterThan(0.4);
  });

  it("word indices spread across noun list (no clustering)", () => {
    const indices = sampleAddresses.map((addr) => {
      const seed = hashAddress(addr);
      const rng = createSeededRng(seed);
      rng(); // skip adjective
      return selectIndex(rng(), NOUNS.length);
    });

    const uniqueIndices = new Set(indices);
    const coverageRatio = uniqueIndices.size / NOUNS.length;
    expect(coverageRatio).toBeGreaterThan(0.4);
  });

  it("multiple addresses produce a variety of first words", () => {
    const firstWords = sampleAddresses.map((addr) => {
      const result = generateNameDetailed(addr);
      return result.parts[0];
    });

    const uniqueFirstWords = new Set(firstWords);
    // Should see at least 40% variety in adjectives
    expect(uniqueFirstWords.size).toBeGreaterThan(ADJECTIVES.length * 0.4);
  });

  it("multiple addresses produce a variety of last words", () => {
    const lastWords = sampleAddresses.map((addr) => {
      const result = generateNameDetailed(addr);
      return result.parts[result.parts.length - 1];
    });

    const uniqueLastWords = new Set(lastWords);
    expect(uniqueLastWords.size).toBeGreaterThan(NOUNS.length * 0.4);
  });

  it("no single word dominates more than 5% of results for adjectives", () => {
    const counts = new Map<string, number>();
    for (const addr of sampleAddresses) {
      const result = generateNameDetailed(addr);
      const word = result.parts[0];
      counts.set(word, (counts.get(word) || 0) + 1);
    }

    const maxCount = Math.max(...counts.values());
    const maxRatio = maxCount / SAMPLE_SIZE;
    // No single adjective should appear more than 5% of the time
    expect(maxRatio).toBeLessThan(0.05);
  });

  it("hash values are well-distributed across 32-bit range", () => {
    const hashes = sampleAddresses.map((addr) => hashAddress(addr));

    // Check that hashes span a significant portion of the 32-bit range
    const min = Math.min(...hashes);
    const max = Math.max(...hashes);
    const range = max - min;

    // The range should span at least 50% of the 32-bit space
    expect(range).toBeGreaterThan(0xffffffff * 0.5);
  });

  it("RNG output covers full range", () => {
    const rng = createSeededRng(42);
    const values = Array.from({ length: 1000 }, () => rng());

    const min = Math.min(...values);
    const max = Math.max(...values);

    // Should see values across a wide range
    expect(min).toBeLessThan(0xffffffff * 0.1);
    expect(max).toBeGreaterThan(0xffffffff * 0.9);
  });
});
