import { describe, it, expect } from "vitest";
import { generateName, generateNameDetailed } from "../generator";
import { ADJECTIVES, NOUNS, EPITHETS } from "../word-lists";

// Sample addresses for testing
const STACKS_ADDRESS = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const STACKS_ADDRESS_2 = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const BITCOIN_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TESTNET_ADDRESS = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

describe("generateName", () => {
  describe("determinism", () => {
    it("same address always produces the same name", () => {
      const name1 = generateName(STACKS_ADDRESS);
      const name2 = generateName(STACKS_ADDRESS);
      const name3 = generateName(STACKS_ADDRESS);
      expect(name1).toBe(name2);
      expect(name2).toBe(name3);
    });

    it("determinism holds across many calls", () => {
      const expected = generateName(BITCOIN_ADDRESS);
      for (let i = 0; i < 100; i++) {
        expect(generateName(BITCOIN_ADDRESS)).toBe(expected);
      }
    });

    it("determinism holds with middleName option", () => {
      const name1 = generateName(STACKS_ADDRESS, { middleName: true });
      const name2 = generateName(STACKS_ADDRESS, { middleName: true });
      expect(name1).toBe(name2);
    });
  });

  describe("collision resistance", () => {
    it("different addresses produce different names", () => {
      const addresses = [
        STACKS_ADDRESS,
        STACKS_ADDRESS_2,
        BITCOIN_ADDRESS,
        TESTNET_ADDRESS,
        "SP1234567890ABCDEFGHIJKLMNOP",
        "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      ];
      const names = addresses.map((a) => generateName(a));
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(addresses.length);
    });

    it("sequential single-char differences produce different names", () => {
      const names = new Set<string>();
      for (let i = 0; i < 26; i++) {
        const addr = "SP" + String.fromCharCode(65 + i).repeat(30);
        names.add(generateName(addr));
      }
      // All 26 should be unique
      expect(names.size).toBe(26);
    });
  });

  describe("name format", () => {
    it("generates a 3-part name by default", () => {
      const name = generateName(STACKS_ADDRESS);
      const parts = name.split(" ");
      expect(parts).toHaveLength(3);
    });

    it("generates a 4-part name with middleName option", () => {
      const name = generateName(STACKS_ADDRESS, { middleName: true });
      const parts = name.split(" ");
      expect(parts).toHaveLength(4);
    });

    it("all parts are capitalized", () => {
      const name = generateName(STACKS_ADDRESS);
      const parts = name.split(" ");
      for (const part of parts) {
        expect(part[0]).toBe(part[0].toUpperCase());
      }
    });

    it("name parts come from the word lists", () => {
      const result = generateNameDetailed(STACKS_ADDRESS);
      const adjLower = result.parts[0].toLowerCase();
      const nounLower = result.parts[1].toLowerCase();
      const epithetLower = result.parts[2].toLowerCase();

      expect(ADJECTIVES).toContain(adjLower);
      expect(NOUNS).toContain(nounLower);
      expect(EPITHETS).toContain(epithetLower);
    });

    it("middle name parts come from adjective word list", () => {
      const result = generateNameDetailed(STACKS_ADDRESS, {
        middleName: true,
      });
      const adj1Lower = result.parts[0].toLowerCase();
      const adj2Lower = result.parts[1].toLowerCase();

      expect(ADJECTIVES).toContain(adj1Lower);
      expect(ADJECTIVES).toContain(adj2Lower);
    });
  });

  describe("edge cases", () => {
    it("handles empty string address", () => {
      const name = generateName("");
      expect(typeof name).toBe("string");
      const parts = name.split(" ");
      expect(parts).toHaveLength(3);
    });

    it("handles very long address", () => {
      const longAddress = "SP" + "X".repeat(10000);
      const name = generateName(longAddress);
      expect(typeof name).toBe("string");
      const parts = name.split(" ");
      expect(parts).toHaveLength(3);
    });

    it("handles special characters in address", () => {
      const name = generateName("!@#$%^&*()_+-=[]{}|;':\",./<>?");
      expect(typeof name).toBe("string");
      const parts = name.split(" ");
      expect(parts).toHaveLength(3);
    });

    it("handles address with only whitespace", () => {
      const name = generateName("   ");
      expect(typeof name).toBe("string");
      const parts = name.split(" ").filter((p) => p.length > 0);
      expect(parts).toHaveLength(3);
    });

    it("handles unicode characters", () => {
      const name = generateName("\u{1F600}\u{1F680}\u{1F4A1}");
      expect(typeof name).toBe("string");
      const parts = name.split(" ");
      expect(parts).toHaveLength(3);
    });
  });
});

describe("generateNameDetailed", () => {
  it("returns correct structure without middleName", () => {
    const result = generateNameDetailed(STACKS_ADDRESS);
    expect(result).toHaveProperty("full");
    expect(result).toHaveProperty("parts");
    expect(typeof result.full).toBe("string");
    expect(Array.isArray(result.parts)).toBe(true);
    expect(result.parts).toHaveLength(3);
  });

  it("returns correct structure with middleName", () => {
    const result = generateNameDetailed(STACKS_ADDRESS, { middleName: true });
    expect(result.parts).toHaveLength(4);
  });

  it("full name matches joined parts", () => {
    const result = generateNameDetailed(STACKS_ADDRESS);
    expect(result.full).toBe(result.parts.join(" "));
  });

  it("full name matches joined parts with middleName", () => {
    const result = generateNameDetailed(BITCOIN_ADDRESS, {
      middleName: true,
    });
    expect(result.full).toBe(result.parts.join(" "));
  });

  it("generateName returns same string as generateNameDetailed.full", () => {
    const name = generateName(STACKS_ADDRESS);
    const detailed = generateNameDetailed(STACKS_ADDRESS);
    expect(name).toBe(detailed.full);
  });

  it("without middleName differs from with middleName", () => {
    const without = generateNameDetailed(STACKS_ADDRESS);
    const withMiddle = generateNameDetailed(STACKS_ADDRESS, {
      middleName: true,
    });
    // The full names should differ since one has an extra word
    expect(without.full).not.toBe(withMiddle.full);
    expect(without.parts.length).not.toBe(withMiddle.parts.length);
  });
});
