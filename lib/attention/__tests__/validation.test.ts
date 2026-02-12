import { describe, it, expect } from "vitest";
import {
  validateResponseBody,
  validatePayoutBody,
  validateMessageBody,
} from "../validation";

describe("validateResponseBody", () => {
  describe("success cases", () => {
    it("accepts valid response with hex signature", () => {
      const result = validateResponseBody({
        signature: "a".repeat(130), // 65 bytes hex
        response: "I am paying attention",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        signature: "a".repeat(130),
        response: "I am paying attention",
      });
    });

    it("accepts valid response with base64 signature", () => {
      // Valid base64 signature (88 chars, ~66 bytes decoded)
      const result = validateResponseBody({
        signature: "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IHNpZ25hdHVyZSBmb3IgQklQLTEzNyB2YWxpZGF0aW9uLiBUaGlzIGlzIGEgY29tcGxldGUgdmFsaWQgc2lnbmF0dXJlLg==",
        response: "I am paying attention",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.response).toBe("I am paying attention");
    });

    it("accepts response at max length (500 chars)", () => {
      const response = "a".repeat(500);
      const result = validateResponseBody({
        signature: "a".repeat(130),
        response,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.response).toBe(response);
    });

    it("preserves whitespace in response", () => {
      const result = validateResponseBody({
        signature: "a".repeat(130),
        response: "  spaced  text  ",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.response).toBe("  spaced  text  ");
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateResponseBody("not an object");
      expect(result.data).toBeUndefined();
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects null body", () => {
      const result = validateResponseBody(null);
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects missing signature", () => {
      const result = validateResponseBody({
        response: "test",
      });
      expect(result.errors).toContain("signature must be a string");
    });

    it("rejects empty signature", () => {
      const result = validateResponseBody({
        signature: "",
        response: "test",
      });
      expect(result.errors).toContain("signature cannot be empty");
    });

    it("rejects invalid signature format", () => {
      const result = validateResponseBody({
        signature: "not-valid-encoding!@#$",
        response: "test",
      });
      expect(result.errors).toContain("signature must be base64 or hex-encoded");
    });

    it("rejects hex signature with wrong length", () => {
      const result = validateResponseBody({
        signature: "a".repeat(64), // Too short
        response: "test",
      });
      expect(result.errors).toContain("hex signature must be 130 characters (65 bytes)");
    });

    it("rejects base64 signature that is too short", () => {
      const result = validateResponseBody({
        signature: "SGVsbG8=", // Too short
        response: "test",
      });
      expect(result.errors).toContain("base64 signature appears too short");
    });

    it("rejects missing response", () => {
      const result = validateResponseBody({
        signature: "a".repeat(130),
      });
      expect(result.errors).toContain("response must be a string");
    });

    it("rejects empty response", () => {
      const result = validateResponseBody({
        signature: "a".repeat(130),
        response: "   ", // Only whitespace
      });
      expect(result.errors).toContain("response cannot be empty");
    });

    it("rejects response exceeding max length", () => {
      const result = validateResponseBody({
        signature: "a".repeat(130),
        response: "a".repeat(501),
      });
      expect(result.errors).toContain("response exceeds maximum length of 500 characters");
    });

    it("accumulates multiple errors", () => {
      const result = validateResponseBody({
        signature: 123, // Wrong type
        response: "", // Empty
      });
      expect(result.errors?.length).toBeGreaterThan(1);
    });
  });
});

describe("validatePayoutBody", () => {
  const validPayoutData = {
    btcAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    messageId: "msg_123",
    rewardTxid: "a".repeat(64),
    rewardSatoshis: 1000,
    paidAt: "2026-02-10T12:00:00.000Z",
  };

  describe("success cases", () => {
    it("accepts valid payout data", () => {
      const result = validatePayoutBody(validPayoutData);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        ...validPayoutData,
        rewardTxid: validPayoutData.rewardTxid.toLowerCase(),
      });
    });

    it("normalizes rewardTxid to lowercase", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardTxid: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
      });
      expect(result.data?.rewardTxid).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    });

    it("accepts maximum valid satoshi amount", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardSatoshis: 2100000000000000,
      });
      expect(result.errors).toBeUndefined();
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validatePayoutBody("not an object");
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects invalid BTC address format", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        btcAddress: "not-a-valid-address",
      });
      expect(result.errors?.some(e => e.includes("Native SegWit"))).toBe(true);
    });

    it("rejects non-bc1 address", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        btcAddress: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Legacy address
      });
      expect(result.errors?.some(e => e.includes("bc1"))).toBe(true);
    });

    it("rejects empty messageId", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        messageId: "   ",
      });
      expect(result.errors).toContain("messageId cannot be empty");
    });

    it("rejects invalid txid length", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardTxid: "abc123", // Too short
      });
      expect(result.errors).toContain("rewardTxid must be a 64-character hex string");
    });

    it("rejects non-hex txid", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardTxid: "x".repeat(64),
      });
      expect(result.errors).toContain("rewardTxid must be a 64-character hex string");
    });

    it("rejects zero satoshis", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardSatoshis: 0,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects negative satoshis", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardSatoshis: -100,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects non-integer satoshis", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        rewardSatoshis: 123.45,
      });
      expect(result.errors).toContain("rewardSatoshis must be a positive integer");
    });

    it("rejects non-canonical ISO date", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        paidAt: "2026-02-10T12:00:00Z", // Missing milliseconds
      });
      expect(result.errors?.some(e => e.includes("canonical ISO 8601"))).toBe(true);
    });

    it("rejects invalid date string", () => {
      const result = validatePayoutBody({
        ...validPayoutData,
        paidAt: "not-a-date",
      });
      expect(result.errors?.some(e => e.includes("ISO 8601"))).toBe(true);
    });
  });
});

describe("validateMessageBody", () => {
  describe("success cases", () => {
    it("accepts valid message content", () => {
      const result = validateMessageBody({
        content: "New message content",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        content: "New message content",
        closedAt: undefined,
      });
    });

    it("accepts message with closedAt timestamp", () => {
      const closedAt = "2026-02-10T12:00:00.000Z";
      const result = validateMessageBody({
        content: "New message",
        closedAt,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        content: "New message",
        closedAt,
      });
    });

    it("accepts very long content", () => {
      const content = "a".repeat(10000);
      const result = validateMessageBody({ content });
      expect(result.errors).toBeUndefined();
      expect(result.data?.content).toBe(content);
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateMessageBody("not an object");
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects missing content", () => {
      const result = validateMessageBody({});
      expect(result.errors).toContain("content must be a string");
    });

    it("rejects empty content", () => {
      const result = validateMessageBody({
        content: "   ",
      });
      expect(result.errors).toContain("content cannot be empty");
    });

    it("rejects non-string content", () => {
      const result = validateMessageBody({
        content: 123,
      });
      expect(result.errors).toContain("content must be a string");
    });

    it("rejects non-canonical closedAt", () => {
      const result = validateMessageBody({
        content: "test",
        closedAt: "2026-02-10T12:00:00Z", // Missing milliseconds
      });
      expect(result.errors?.some(e => e.includes("canonical ISO 8601"))).toBe(true);
    });

    it("rejects invalid closedAt date", () => {
      const result = validateMessageBody({
        content: "test",
        closedAt: "not-a-date",
      });
      expect(result.errors?.some(e => e.includes("ISO 8601"))).toBe(true);
    });

    it("rejects non-string closedAt", () => {
      const result = validateMessageBody({
        content: "test",
        closedAt: 123,
      });
      expect(result.errors).toContain("closedAt must be a string if provided");
    });
  });
});
