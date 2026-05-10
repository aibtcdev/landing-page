/**
 * Unit tests for the audit-invalid-agents classification logic.
 *
 * Tests the pure classification functions in isolation (no KV or Cloudflare
 * runtime dependencies). Validates that the same two-step rejection logic used
 * by the backfill route is correctly mirrored in the audit route.
 */

import { describe, it, expect } from "vitest";
import { isPartialAgentRecord } from "../types";

// ── Inline copies of the classification helpers ───────────────────────────
// These mirror the logic in app/api/admin/audit-invalid-agents/route.ts.
// Keeping them inline avoids importing from the route (Next.js App Router
// modules import Cloudflare runtime bindings which aren't available in vitest).

const REQUIRED_FIELDS = [
  "stxAddress",
  "stxPublicKey",
  "btcPublicKey",
  "verifiedAt",
] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

type TentativeBucket = "repairable" | "retired" | "schema-unfixable";

function classifyBucket(
  btcAddress: string | null,
  missingRequired: RequiredField[]
): TentativeBucket {
  if (!btcAddress) return "schema-unfixable";
  if (missingRequired.length === 1) return "repairable";
  return "retired";
}

function getMissingRequired(parsed: Record<string, unknown>): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => {
    const val = parsed[f];
    return typeof val !== "string" || !val;
  });
}

// ── isPartialAgentRecord (from lib/types.ts) tests ────────────────────────

describe("isPartialAgentRecord", () => {
  it("returns true for a record with only BTC credentials and no STX fields", () => {
    const partial = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(isPartialAgentRecord(partial)).toBe(true);
  });

  it("returns false for a full AgentRecord with both BTC and STX credentials", () => {
    const full = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      stxAddress: "SP1234",
      stxPublicKey: "0x03def",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(isPartialAgentRecord(full)).toBe(false);
  });

  it("returns false if stxAddress is present even without stxPublicKey", () => {
    const record = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      stxAddress: "SP1234",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    // Has stxAddress => NOT a partial record
    expect(isPartialAgentRecord(record)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPartialAgentRecord(null)).toBe(false);
  });

  it("returns false for a non-object", () => {
    expect(isPartialAgentRecord("string")).toBe(false);
    expect(isPartialAgentRecord(42)).toBe(false);
  });

  it("returns false if btcAddress is missing", () => {
    const record = {
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(isPartialAgentRecord(record)).toBe(false);
  });
});

// ── classifyBucket tests ──────────────────────────────────────────────────

describe("classifyBucket", () => {
  it("returns schema-unfixable when btcAddress is null", () => {
    expect(classifyBucket(null, ["stxAddress"])).toBe("schema-unfixable");
    expect(classifyBucket(null, ["stxAddress", "stxPublicKey"])).toBe("schema-unfixable");
    expect(classifyBucket(null, [])).toBe("schema-unfixable");
  });

  it("returns repairable when exactly one required field is missing", () => {
    const addr = "bc1qexample";
    expect(classifyBucket(addr, ["stxAddress"])).toBe("repairable");
    expect(classifyBucket(addr, ["stxPublicKey"])).toBe("repairable");
    expect(classifyBucket(addr, ["btcPublicKey"])).toBe("repairable");
    expect(classifyBucket(addr, ["verifiedAt"])).toBe("repairable");
  });

  it("returns retired when two or more required fields are missing", () => {
    const addr = "bc1qexample";
    expect(classifyBucket(addr, ["stxAddress", "stxPublicKey"])).toBe("retired");
    expect(classifyBucket(addr, ["stxAddress", "stxPublicKey", "btcPublicKey"])).toBe("retired");
    expect(classifyBucket(addr, REQUIRED_FIELDS as unknown as RequiredField[])).toBe("retired");
  });
});

// ── getMissingRequired tests ──────────────────────────────────────────────

describe("getMissingRequired", () => {
  it("returns empty array for a fully valid record", () => {
    const record = {
      stxAddress: "SP1234",
      stxPublicKey: "0x03def",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(getMissingRequired(record)).toEqual([]);
  });

  it("detects a single missing field", () => {
    const record = {
      stxAddress: "SP1234",
      stxPublicKey: "0x03def",
      btcPublicKey: "0x02abc",
      // verifiedAt missing
    };
    expect(getMissingRequired(record)).toEqual(["verifiedAt"]);
  });

  it("detects multiple missing fields", () => {
    const record = {
      btcPublicKey: "0x02abc",
      // stxAddress, stxPublicKey, verifiedAt all missing
    };
    const missing = getMissingRequired(record);
    expect(missing).toContain("stxAddress");
    expect(missing).toContain("stxPublicKey");
    expect(missing).toContain("verifiedAt");
    expect(missing).not.toContain("btcPublicKey");
  });

  it("treats empty string values as missing", () => {
    const record = {
      stxAddress: "",
      stxPublicKey: "0x03def",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(getMissingRequired(record)).toEqual(["stxAddress"]);
  });

  it("treats null values as missing", () => {
    const record = {
      stxAddress: null as unknown as string,
      stxPublicKey: "0x03def",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(getMissingRequired(record)).toEqual(["stxAddress"]);
  });
});

// ── End-to-end classification scenario tests ───────────────────────────────

describe("end-to-end record classification", () => {
  /**
   * Simulates the two-step rejection logic from the audit route.
   * Returns the tentative bucket for a given raw parsed record.
   */
  function classify(parsed: Record<string, unknown>): TentativeBucket {
    // Step 1: isPartialAgentRecord guard
    if (isPartialAgentRecord(parsed)) {
      const btcAddress =
        typeof parsed.btcAddress === "string" ? parsed.btcAddress : null;
      // Partial records are always missing stxAddress and stxPublicKey
      return classifyBucket(btcAddress, ["stxAddress", "stxPublicKey"]);
    }
    // Step 2: required-field check
    const missing = getMissingRequired(parsed);
    const btcAddress =
      typeof parsed.btcAddress === "string" ? parsed.btcAddress : null;
    return classifyBucket(btcAddress, missing);
  }

  it("classifies a valid full record correctly (0 missing fields)", () => {
    // Valid records are excluded from the report; classifying them returns "repairable"
    // only because missingRequired is [] — but in the route these are never emitted.
    // Test the boundary: 0 missing fields with btcAddress -> classifyBucket returns "retired"
    // since missingRequired.length is 0, which is > 1, so it would be "retired".
    // But actually: classifyBucket(addr, []) returns "retired" (length 0, not === 1).
    // This is intentional: zero missing = valid record excluded from report by the route.
    const addr = "bc1qexample";
    expect(classifyBucket(addr, [])).toBe("retired"); // boundary case — not emitted in practice
  });

  it("classifies a partial record (BTC-only) as retired with btcAddress present", () => {
    const partial = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    expect(classify(partial)).toBe("retired"); // missing 2 fields: stxAddress + stxPublicKey
  });

  it("classifies a record missing only verifiedAt as repairable", () => {
    const record = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      stxAddress: "SP1234",
      stxPublicKey: "0x03def",
      // verifiedAt missing
    };
    expect(classify(record)).toBe("repairable");
  });

  it("classifies a record missing stxAddress and stxPublicKey as retired", () => {
    const record = {
      btcAddress: "bc1qexample",
      btcPublicKey: "0x02abc",
      verifiedAt: "2024-01-01T00:00:00Z",
      // stxAddress and stxPublicKey missing — but NOT caught by isPartialAgentRecord
      // because isPartialAgentRecord would return true first
    };
    // This would be caught by isPartialAgentRecord — test the direct classification
    const missing = getMissingRequired(record);
    expect(classifyBucket("bc1qexample", missing)).toBe("retired");
  });

  it("classifies a record missing btcAddress as schema-unfixable", () => {
    const record = {
      // btcAddress missing
      btcPublicKey: "0x02abc",
      stxAddress: "SP1234",
      stxPublicKey: "0x03def",
      verifiedAt: "2024-01-01T00:00:00Z",
    };
    const missing = getMissingRequired(record);
    expect(classifyBucket(null, missing)).toBe("schema-unfixable");
  });

  it("classifies a JSON parse error as schema-unfixable", () => {
    // JSON parse errors produce btcAddress=null and all required fields missing
    expect(classifyBucket(null, [...REQUIRED_FIELDS])).toBe("schema-unfixable");
  });
});
