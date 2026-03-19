import { describe, it, expect } from "vitest";
import {
  validateInboxMessage,
  validateOutboxReply,
  validateMarkRead,
} from "../validation";

/** Helper: check if any error object has the given message. */
function hasError(
  errors: { message: string }[] | undefined,
  message: string
): boolean {
  return errors?.some((e) => e.message === message) ?? false;
}

/** Helper: check if any error message contains the given text. */
function hasErrorContaining(
  errors: { message: string }[] | undefined,
  text: string
): boolean {
  return errors?.some((e) => e.message.includes(text)) ?? false;
}

describe("validateInboxMessage", () => {
  describe("success cases", () => {
    it("accepts valid inbox message", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, this is a test message!",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, this is a test message!",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
    });

    it("accepts content at max length (500 chars)", () => {
      const content = "a".repeat(500);
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content,
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.content).toBe(content);
    });

    it("normalizes paymentTxid to lowercase", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "ABCDEF" + "0".repeat(58),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.paymentTxid).toBe("abcdef" + "0".repeat(58));
    });

    it("accepts mainnet Stacks address with SM prefix", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.toStxAddress).toBe(
        "SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
    });

    it("preserves whitespace in content", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "  spaced  text  ",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.content).toBe("  spaced  text  ");
    });

    it("accepts message without paymentTxid (initial 402 request)", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, this is a test message!",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.paymentTxid).toBeUndefined();
      expect(result.data?.paymentSatoshis).toBeUndefined();
    });

    it("accepts message without paymentSatoshis", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.paymentTxid).toBe("a".repeat(64));
      expect(result.data?.paymentSatoshis).toBeUndefined();
    });

    it("accepts message without signature (unchanged behavior)", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, this is a test message!",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.signature).toBeUndefined();
    });

    it("accepts message with valid hex signature", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, agent!",
        signature: "a".repeat(130), // 65 bytes hex
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.signature).toBe("a".repeat(130));
    });

    it("accepts message with valid base64 signature", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Hello, agent!",
        signature:
          "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IHNpZ25hdHVyZSBmb3IgQklQLTEzNyB2YWxpZGF0aW9uLiBUaGlzIGlzIGEgY29tcGxldGUgdmFsaWQgc2lnbmF0dXJlLg==",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.signature).toBeDefined();
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateInboxMessage("not an object");
      expect(result.data).toBeUndefined();
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects null body", () => {
      const result = validateInboxMessage(null);
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects missing toBtcAddress", () => {
      const result = validateInboxMessage({
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(hasError(result.errors, "toBtcAddress must be a string")).toBe(true);
    });

    it("rejects invalid toBtcAddress format", () => {
      const result = validateInboxMessage({
        toBtcAddress: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Legacy address
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(hasErrorContaining(result.errors, "Native SegWit")).toBe(true);
    });

    it("rejects missing toStxAddress", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(hasError(result.errors, "toStxAddress must be a string")).toBe(true);
    });

    it("rejects invalid toStxAddress format", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "ST123", // Too short
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(hasErrorContaining(result.errors, "Stacks address")).toBe(true);
    });

    it("rejects empty content", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "   ", // Whitespace only
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(hasError(result.errors, "content cannot be empty")).toBe(true);
    });

    it("rejects content exceeding max length", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "a".repeat(501), // Over 500 chars
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100,
      });
      expect(
        hasError(result.errors, "content exceeds maximum length of 500 characters")
      ).toBe(true);
    });

    it("rejects invalid paymentTxid format", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "not-hex", // Invalid hex
        paymentSatoshis: 100,
      });
      expect(
        hasError(result.errors, "paymentTxid must be a 64-character hex string")
      ).toBe(true);
    });

    it("rejects paymentTxid with wrong length", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(32), // Too short
        paymentSatoshis: 100,
      });
      expect(
        hasError(result.errors, "paymentTxid must be a 64-character hex string")
      ).toBe(true);
    });

    it("rejects negative paymentSatoshis", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: -100,
      });
      expect(
        hasError(result.errors, "paymentSatoshis must be a positive integer")
      ).toBe(true);
    });

    it("rejects zero paymentSatoshis", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 0,
      });
      expect(
        hasError(result.errors, "paymentSatoshis must be a positive integer")
      ).toBe(true);
    });

    it("rejects fractional paymentSatoshis", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test",
        paymentTxid: "a".repeat(64),
        paymentSatoshis: 100.5,
      });
      expect(
        hasError(result.errors, "paymentSatoshis must be a positive integer")
      ).toBe(true);
    });

    it("rejects invalid signature format", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test message",
        signature: "not-valid-encoding!@#$",
      });
      expect(
        hasError(result.errors, "signature must be base64 or hex-encoded")
      ).toBe(true);
    });

    it("rejects hex signature with wrong length", () => {
      const result = validateInboxMessage({
        toBtcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        toStxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        content: "Test message",
        signature: "a".repeat(64), // Too short — 32 bytes instead of 65
      });
      expect(
        hasError(result.errors, "hex signature must be 130 characters (65 bytes)")
      ).toBe(true);
    });

    it("collects multiple validation errors", () => {
      const result = validateInboxMessage({
        toBtcAddress: "invalid",
        toStxAddress: "invalid",
        content: "",
        paymentTxid: "invalid",
        paymentSatoshis: -1,
      });
      expect(result.errors?.length).toBeGreaterThanOrEqual(5);
    });

    it("each error object has field, message, and hint", () => {
      const result = validateInboxMessage({
        toBtcAddress: "invalid",
        toStxAddress: "invalid",
        content: "Test",
      });
      expect(result.errors?.length).toBeGreaterThan(0);
      for (const err of result.errors ?? []) {
        expect(typeof err.field).toBe("string");
        expect(typeof err.message).toBe("string");
        expect(typeof err.hint).toBe("string");
      }
    });
  });
});

describe("validateOutboxReply", () => {
  describe("success cases", () => {
    it("accepts valid reply with hex signature", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Thanks for the message!",
        signature: "a".repeat(130), // 65 bytes hex
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        messageId: "msg_123",
        reply: "Thanks for the message!",
        signature: "a".repeat(130),
      });
    });

    it("accepts valid reply with base64 signature", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Thanks!",
        signature:
          "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IHNpZ25hdHVyZSBmb3IgQklQLTEzNyB2YWxpZGF0aW9uLiBUaGlzIGlzIGEgY29tcGxldGUgdmFsaWQgc2lnbmF0dXJlLg==",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.messageId).toBe("msg_123");
    });

    it("accepts reply at max length", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "a".repeat(500),
        signature: "a".repeat(130),
      });
      expect(result.errors).toBeUndefined();
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateOutboxReply("not an object");
      expect(result.data).toBeUndefined();
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects null body", () => {
      const result = validateOutboxReply(null);
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects missing messageId", () => {
      const result = validateOutboxReply({
        reply: "Test",
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "messageId must be a string")).toBe(true);
    });

    it("rejects empty messageId", () => {
      const result = validateOutboxReply({
        messageId: "   ", // Whitespace only
        reply: "Test",
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "messageId cannot be empty")).toBe(true);
    });

    it("rejects missing reply", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "reply must be a string")).toBe(true);
    });

    it("rejects empty reply", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "   ", // Whitespace only
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "reply cannot be empty")).toBe(true);
    });

    it("rejects reply exceeding max length", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "a".repeat(501), // Over 500 chars
        signature: "a".repeat(130),
      });
      expect(
        hasError(result.errors, "reply exceeds maximum length of 500 characters")
      ).toBe(true);
    });

    it("rejects missing signature", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Test",
      });
      expect(hasError(result.errors, "signature must be a string")).toBe(true);
    });

    it("rejects empty signature", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Test",
        signature: "",
      });
      expect(hasError(result.errors, "signature cannot be empty")).toBe(true);
    });

    it("rejects invalid signature format", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Test",
        signature: "not-valid-encoding!@#$",
      });
      expect(
        hasError(result.errors, "signature must be base64 or hex-encoded")
      ).toBe(true);
    });

    it("rejects hex signature with wrong length", () => {
      const result = validateOutboxReply({
        messageId: "msg_123",
        reply: "Test",
        signature: "a".repeat(64), // Too short
      });
      expect(
        hasError(result.errors, "hex signature must be 130 characters (65 bytes)")
      ).toBe(true);
    });

    it("collects multiple validation errors", () => {
      const result = validateOutboxReply({
        messageId: "",
        reply: "",
        signature: "invalid",
      });
      expect(result.errors?.length).toBeGreaterThanOrEqual(3);
    });

    it("each error object has field, message, and hint", () => {
      const result = validateOutboxReply({
        messageId: "",
        reply: "",
        signature: "invalid",
      });
      expect(result.errors?.length).toBeGreaterThan(0);
      for (const err of result.errors ?? []) {
        expect(typeof err.field).toBe("string");
        expect(typeof err.message).toBe("string");
        expect(typeof err.hint).toBe("string");
      }
    });
  });
});

describe("validateMarkRead", () => {
  describe("success cases", () => {
    it("accepts valid mark-read with hex signature", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
        signature: "a".repeat(130), // 65 bytes hex
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        messageId: "msg_123",
        signature: "a".repeat(130),
      });
    });

    it("accepts valid mark-read with base64 signature", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
        signature:
          "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IHNpZ25hdHVyZSBmb3IgQklQLTEzNyB2YWxpZGF0aW9uLiBUaGlzIGlzIGEgY29tcGxldGUgdmFsaWQgc2lnbmF0dXJlLg==",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.messageId).toBe("msg_123");
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateMarkRead("not an object");
      expect(result.data).toBeUndefined();
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects null body", () => {
      const result = validateMarkRead(null);
      expect(hasError(result.errors, "Request body must be a JSON object")).toBe(true);
    });

    it("rejects missing messageId", () => {
      const result = validateMarkRead({
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "messageId must be a string")).toBe(true);
    });

    it("rejects empty messageId", () => {
      const result = validateMarkRead({
        messageId: "   ", // Whitespace only
        signature: "a".repeat(130),
      });
      expect(hasError(result.errors, "messageId cannot be empty")).toBe(true);
    });

    it("rejects missing signature", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
      });
      expect(hasError(result.errors, "signature must be a string")).toBe(true);
    });

    it("rejects empty signature", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
        signature: "",
      });
      expect(hasError(result.errors, "signature cannot be empty")).toBe(true);
    });

    it("rejects invalid signature format", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
        signature: "not-valid-encoding!@#$",
      });
      expect(
        hasError(result.errors, "signature must be base64 or hex-encoded")
      ).toBe(true);
    });

    it("rejects hex signature with wrong length", () => {
      const result = validateMarkRead({
        messageId: "msg_123",
        signature: "a".repeat(64), // Too short
      });
      expect(
        hasError(result.errors, "hex signature must be 130 characters (65 bytes)")
      ).toBe(true);
    });

    it("collects multiple validation errors", () => {
      const result = validateMarkRead({
        messageId: "",
        signature: "invalid",
      });
      expect(result.errors?.length).toBeGreaterThanOrEqual(2);
    });

    it("each error object has field, message, and hint", () => {
      const result = validateMarkRead({
        messageId: "",
        signature: "invalid",
      });
      expect(result.errors?.length).toBeGreaterThan(0);
      for (const err of result.errors ?? []) {
        expect(typeof err.field).toBe("string");
        expect(typeof err.message).toBe("string");
        expect(typeof err.hint).toBe("string");
      }
    });
  });
});
