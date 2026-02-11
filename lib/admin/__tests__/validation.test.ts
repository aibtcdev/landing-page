import { describe, it, expect } from "vitest";
import { validateGenesisPayoutBody } from "../validation";

describe("validateGenesisPayoutBody", () => {
  const validPayoutData = {
    btcAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    rewardTxid: "a".repeat(64),
    rewardSatoshis: 1000,
    paidAt: "2026-02-06T19:00:00.000Z",
  };

  describe("success cases", () => {
    it("accepts valid payout without stxAddress", () => {
      const result = validateGenesisPayoutBody(validPayoutData);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        ...validPayoutData,
        rewardTxid: validPayoutData.rewardTxid.toLowerCase(),
        stxAddress: undefined,
      });
    });

    it("accepts valid payout with stxAddress", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.stxAddress).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
    });

    it("normalizes rewardTxid to lowercase", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardTxid: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
      });
      expect(result.data?.rewardTxid).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    });

    it("accepts mixed case rewardTxid", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardTxid: "AbCdEf0123456789aBcDeF0123456789AbCdEf0123456789aBcDeF0123456789",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.rewardTxid).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    });

    it("accepts maximum valid satoshi amount", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardSatoshis: 2100000000000000,
      });
      expect(result.errors).toBeUndefined();
    });

    it("accepts 40-character stxAddress", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP" + "1".repeat(38), // 40 chars total
      });
      expect(result.errors).toBeUndefined();
    });

    it("accepts 41-character stxAddress", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP" + "1".repeat(39), // 41 chars total
      });
      expect(result.errors).toBeUndefined();
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateGenesisPayoutBody("not an object");
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects null body", () => {
      const result = validateGenesisPayoutBody(null);
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects undefined body", () => {
      const result = validateGenesisPayoutBody(undefined);
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects invalid BTC address format", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: "not-a-valid-address",
      });
      expect(result.errors?.some(e => e.includes("Native SegWit"))).toBe(true);
    });

    it("rejects non-bc1 BTC address", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Legacy address
      });
      expect(result.errors?.some(e => e.includes("bc1"))).toBe(true);
    });

    it("rejects BTC address with uppercase characters", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", // Uppercase
      });
      expect(result.errors?.some(e => e.includes("lowercase"))).toBe(true);
    });

    it("rejects BTC address that is too short", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: "bc1qshort",
      });
      expect(result.errors?.some(e => e.includes("42-62"))).toBe(true);
    });

    it("rejects BTC address that is too long", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: "bc1q" + "a".repeat(90),
      });
      expect(result.errors?.some(e => e.includes("42-62"))).toBe(true);
    });

    it("rejects non-string btcAddress", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        btcAddress: 123,
      });
      expect(result.errors).toContain("btcAddress must be a string");
    });

    it("rejects invalid txid length", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardTxid: "abc123", // Too short
      });
      expect(result.errors).toContain("rewardTxid must be a 64-character hex string");
    });

    it("rejects non-hex txid", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardTxid: "x".repeat(64),
      });
      expect(result.errors).toContain("rewardTxid must be a 64-character hex string");
    });

    it("rejects non-string rewardTxid", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardTxid: 123,
      });
      expect(result.errors).toContain("rewardTxid must be a string");
    });

    it("rejects zero satoshis", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardSatoshis: 0,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects negative satoshis", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardSatoshis: -100,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects non-integer satoshis", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardSatoshis: 123.45,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects non-number rewardSatoshis", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        rewardSatoshis: "1000",
      });
      expect(result.errors).toContain("rewardSatoshis must be a number");
    });

    it("rejects non-canonical ISO date", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        paidAt: "2026-02-06T19:00:00Z", // Missing milliseconds
      });
      expect(result.errors?.some(e => e.includes("canonical ISO 8601"))).toBe(true);
    });

    it("rejects invalid date string", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        paidAt: "not-a-date",
      });
      expect(result.errors?.some(e => e.includes("ISO 8601"))).toBe(true);
    });

    it("rejects date without time", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        paidAt: "2026-02-06",
      });
      expect(result.errors?.some(e => e.includes("canonical"))).toBe(true);
    });

    it("rejects non-string paidAt", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        paidAt: 123,
      });
      expect(result.errors).toContain("paidAt must be a string");
    });

    it("rejects invalid stxAddress format", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "not-a-stacks-address",
      });
      expect(result.errors?.some(e => e.includes("Stacks mainnet"))).toBe(true);
    });

    it("rejects stxAddress not starting with SP", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "ST2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", // Testnet
      });
      expect(result.errors?.some(e => e.includes("SP"))).toBe(true);
    });

    it("rejects stxAddress that is too short", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP123",
      });
      expect(result.errors?.some(e => e.includes("40-41"))).toBe(true);
    });

    it("rejects stxAddress that is too long", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP" + "1".repeat(50),
      });
      expect(result.errors?.some(e => e.includes("40-41"))).toBe(true);
    });

    it("rejects stxAddress with invalid characters", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: "SP0OIl" + "1".repeat(35), // Contains 0, O, I, l (invalid in base58)
      });
      expect(result.errors?.some(e => e.includes("base58"))).toBe(true);
    });

    it("rejects non-string stxAddress", () => {
      const result = validateGenesisPayoutBody({
        ...validPayoutData,
        stxAddress: 123,
      });
      expect(result.errors).toContain("stxAddress must be a string if provided");
    });

    it("accumulates multiple errors", () => {
      const result = validateGenesisPayoutBody({
        btcAddress: "invalid",
        rewardTxid: "short",
        rewardSatoshis: 0,
        paidAt: "not-a-date",
        stxAddress: "invalid",
      });
      expect(result.errors?.length).toBeGreaterThan(3);
    });
  });
});
