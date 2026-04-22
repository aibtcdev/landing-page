/**
 * Regression tests for issue #629:
 * POST /api/inbox/[address] returned 500 when the x402 payment-signature header
 * contained a payload missing the optional `accepted` field.
 *
 * These tests exercise:
 * 1. HttpPaymentPayloadSchema validation logic (mirrors the route's safeParse calls)
 * 2. Both the base64 decode path and the plain-JSON fallback path
 */

import { describe, it, expect } from "vitest";
import { HttpPaymentPayloadSchema } from "@aibtc/tx-schemas/http";

// Minimal valid payload that satisfies the schema (accepted is optional)
const minimalValidPayload = {
  payload: { transaction: "0001aabbccdd" },
};

// Complete payload with the optional accepted field
const completePayload = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "stacks:1",
    amount: "100",
    asset: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-token::sbtc-token",
    payTo: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  },
  resource: {
    url: "https://aibtc.com/api/inbox/SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  },
  payload: {
    transaction: "0001aabbccdd",
  },
};

describe("HttpPaymentPayloadSchema — issue #629 regression", () => {
  describe("base64 decode path", () => {
    it("accepts a valid payload without the optional accepted field (base64-encoded)", () => {
      // Simulates a client that sends only payload.transaction (no accepted)
      const encoded = btoa(JSON.stringify(minimalValidPayload));
      const decoded = atob(encoded);
      const parsed = HttpPaymentPayloadSchema.safeParse(JSON.parse(decoded));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        // accepted should be undefined since it was not provided
        expect(parsed.data.accepted).toBeUndefined();
        expect(parsed.data.payload.transaction).toBe("0001aabbccdd");
      }
    });

    it("accepts a fully-populated payload (base64-encoded)", () => {
      const encoded = btoa(JSON.stringify(completePayload));
      const decoded = atob(encoded);
      const parsed = HttpPaymentPayloadSchema.safeParse(JSON.parse(decoded));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.accepted?.asset).toBe(
          "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-token::sbtc-token"
        );
      }
    });

    it("rejects a payload missing the required transaction field", () => {
      const invalid = { accepted: { scheme: "exact", network: "stacks:1", amount: "100", asset: "X", payTo: "Y" } };
      const encoded = btoa(JSON.stringify(invalid));
      const decoded = atob(encoded);
      const parsed = HttpPaymentPayloadSchema.safeParse(JSON.parse(decoded));

      // schema requires payload.transaction — this should fail
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("plain-JSON fallback path", () => {
    it("accepts a valid payload without the optional accepted field (plain JSON)", () => {
      // Simulates clients that send plain JSON instead of base64 (compat fallback)
      const raw = JSON.stringify(minimalValidPayload);
      const parsed = HttpPaymentPayloadSchema.safeParse(JSON.parse(raw));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.accepted).toBeUndefined();
      }
    });

    it("accepts a fully-populated payload (plain JSON)", () => {
      const raw = JSON.stringify(completePayload);
      const parsed = HttpPaymentPayloadSchema.safeParse(JSON.parse(raw));

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.payload.transaction).toBe("0001aabbccdd");
      }
    });

    it("rejects completely non-JSON input", () => {
      // Confirm that trying to JSON.parse garbage throws, which the route catches
      expect(() => JSON.parse("not-json-at-all!!!")).toThrow();
    });
  });

  describe("safeParse produces structured issues on failure (confirms 400 path)", () => {
    it("issues list is non-empty when payload.transaction is missing", () => {
      const result = HttpPaymentPayloadSchema.safeParse({});

      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod issues are surfaced to callers so they can be returned as 400 body
        expect(Array.isArray(result.error.issues)).toBe(true);
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });
});
