import { describe, it, expect } from "vitest";
import { validateCheckInBody } from "../validation";

describe("validateCheckInBody", () => {
  const validTimestamp = new Date().toISOString();

  describe("success cases", () => {
    it("accepts valid check-in with hex signature", () => {
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: validTimestamp,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        signature: "a".repeat(130),
        timestamp: validTimestamp,
      });
    });

    it("accepts valid check-in with base64 signature", () => {
      const result = validateCheckInBody({
        signature: "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IHNpZ25hdHVyZSBmb3IgQklQLTEzNyB2YWxpZGF0aW9uLiBUaGlzIGlzIGEgY29tcGxldGUgdmFsaWQgc2lnbmF0dXJlLg==",
        timestamp: validTimestamp,
      });
      expect(result.errors).toBeUndefined();
    });

    it("accepts timestamp within 5-minute window (past)", () => {
      const pastTimestamp = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: pastTimestamp,
      });
      expect(result.errors).toBeUndefined();
    });

    it("accepts timestamp within 5-minute window (future)", () => {
      const futureTimestamp = new Date(Date.now() + 4 * 60 * 1000).toISOString();
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: futureTimestamp,
      });
      expect(result.errors).toBeUndefined();
    });

    it("ignores extra fields like type", () => {
      const result = validateCheckInBody({
        type: "check-in",
        signature: "a".repeat(130),
        timestamp: validTimestamp,
      });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        signature: "a".repeat(130),
        timestamp: validTimestamp,
      });
    });
  });

  describe("validation errors", () => {
    it("rejects non-object body", () => {
      const result = validateCheckInBody("not an object");
      expect(result.errors).toContain("Request body must be a JSON object");
    });

    it("rejects invalid signature format", () => {
      const result = validateCheckInBody({
        signature: "invalid!@#$",
        timestamp: validTimestamp,
      });
      expect(result.errors).toContain("signature must be base64 or hex-encoded");
    });

    it("rejects missing signature", () => {
      const result = validateCheckInBody({
        timestamp: validTimestamp,
      });
      expect(result.errors).toContain("signature must be a string");
    });

    it("rejects missing timestamp", () => {
      const result = validateCheckInBody({
        signature: "a".repeat(130),
      });
      expect(result.errors).toContain("timestamp must be a string");
    });

    it("rejects non-canonical ISO timestamp", () => {
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: "2026-02-10", // Not canonical
      });
      expect(result.errors?.some(e => e.includes("canonical ISO 8601"))).toBe(true);
    });

    it("rejects timestamp outside 5-minute window (too old)", () => {
      const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: oldTimestamp,
      });
      expect(result.errors?.some(e => e.includes("within"))).toBe(true);
    });

    it("rejects timestamp outside 5-minute window (too future)", () => {
      const futureTimestamp = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: futureTimestamp,
      });
      expect(result.errors?.some(e => e.includes("within"))).toBe(true);
    });

    it("rejects invalid timestamp string", () => {
      const result = validateCheckInBody({
        signature: "a".repeat(130),
        timestamp: "not-a-date",
      });
      expect(result.errors?.some(e => e.includes("canonical ISO 8601"))).toBe(true);
    });
  });
});
