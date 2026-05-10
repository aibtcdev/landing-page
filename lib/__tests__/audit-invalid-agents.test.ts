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

// ── stx: twin field classification helpers (inline mirrors) ───────────────
// Mirrors the helper logic in route.ts that populates stx_twin_* fields.

type BtcPubkeyFormat = "compressed_02" | "compressed_03" | "uncompressed_04" | "other";

function classifyBtcPubkeyFormat(preview: string): BtcPubkeyFormat {
  if (preview.startsWith("02")) return "compressed_02";
  if (preview.startsWith("03")) return "compressed_03";
  if (preview.startsWith("04")) return "uncompressed_04";
  return "other";
}

interface StxTwinFields {
  stx_twin_present: boolean | null;
  stx_twin_has_btcpubkey: boolean | null;
  stx_twin_btcpubkey_value_preview: string | null;
}

/**
 * Simulate the Phase 2 stx: twin population logic for a given twin KV value.
 *
 * @param stxAddress - The stxAddress extracted from the btc: record (null = no stxAddress)
 * @param twinRaw    - The raw JSON string from the stx:{stxAddress} KV key (null = key absent)
 */
function simulateTwinLookup(
  stxAddress: string | null,
  twinRaw: string | null
): StxTwinFields {
  // No stxAddress → no lookup attempted → all null
  if (!stxAddress) {
    return {
      stx_twin_present: null,
      stx_twin_has_btcpubkey: null,
      stx_twin_btcpubkey_value_preview: null,
    };
  }

  // stxAddress present but twin key absent
  if (twinRaw === null) {
    return {
      stx_twin_present: false,
      stx_twin_has_btcpubkey: null,
      stx_twin_btcpubkey_value_preview: null,
    };
  }

  // twin exists — parse and check for btcPublicKey
  let twinParsed: Record<string, unknown>;
  try {
    twinParsed = JSON.parse(twinRaw) as Record<string, unknown>;
  } catch {
    return {
      stx_twin_present: true,
      stx_twin_has_btcpubkey: false,
      stx_twin_btcpubkey_value_preview: null,
    };
  }

  const twinBtcPubkey = twinParsed["btcPublicKey"];
  if (typeof twinBtcPubkey === "string" && twinBtcPubkey) {
    return {
      stx_twin_present: true,
      stx_twin_has_btcpubkey: true,
      stx_twin_btcpubkey_value_preview: twinBtcPubkey.slice(0, 8),
    };
  }

  return {
    stx_twin_present: true,
    stx_twin_has_btcpubkey: false,
    stx_twin_btcpubkey_value_preview: null,
  };
}

// ── stx: twin logic tests ─────────────────────────────────────────────────

describe("stx: twin btcPublicKey check (Step 1.5)", () => {
  // The canonical repair-path case: twin exists and has btcPublicKey
  it("records stx_twin_present=true and stx_twin_has_btcpubkey=true when twin has btcPublicKey", () => {
    const twinRecord = JSON.stringify({
      btcAddress: "bc1qexample",
      btcPublicKey: "02a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      stxAddress: "SP1234",
      stxPublicKey: "03def456",
      verifiedAt: "2024-01-01T00:00:00Z",
    });

    const result = simulateTwinLookup("SP1234", twinRecord);
    expect(result.stx_twin_present).toBe(true);
    expect(result.stx_twin_has_btcpubkey).toBe(true);
    // preview should be exactly 8 chars, starting with "02"
    expect(result.stx_twin_btcpubkey_value_preview).toBe("02a1b2c3");
  });

  // Critical gap case: twin exists but lacks btcPublicKey (repair not straightforward)
  it("records stx_twin_present=true and stx_twin_has_btcpubkey=false when twin lacks btcPublicKey", () => {
    const twinRecord = JSON.stringify({
      btcAddress: "bc1qexample",
      // btcPublicKey intentionally absent
      stxAddress: "SP1234",
      stxPublicKey: "03def456",
      verifiedAt: "2024-01-01T00:00:00Z",
    });

    const result = simulateTwinLookup("SP1234", twinRecord);
    expect(result.stx_twin_present).toBe(true);
    expect(result.stx_twin_has_btcpubkey).toBe(false);
    expect(result.stx_twin_btcpubkey_value_preview).toBeNull();
  });

  // No twin case: stx: key doesn't exist in KV
  it("records stx_twin_present=false when the stx: twin key is absent", () => {
    const result = simulateTwinLookup("SP1234", null);
    expect(result.stx_twin_present).toBe(false);
    expect(result.stx_twin_has_btcpubkey).toBeNull();
    expect(result.stx_twin_btcpubkey_value_preview).toBeNull();
  });

  // No stxAddress in btc: record — no lookup should have been attempted
  it("leaves all stx_twin_* fields as null when the btc: record has no stxAddress", () => {
    // Simulates a partial record (BTC-only) with no stxAddress — no twin key to look up
    const result = simulateTwinLookup(null, null);
    expect(result.stx_twin_present).toBeNull();
    expect(result.stx_twin_has_btcpubkey).toBeNull();
    expect(result.stx_twin_btcpubkey_value_preview).toBeNull();
  });

  // Preview only stores first 8 chars — not the full key
  it("stores only the first 8 characters of btcPublicKey as preview", () => {
    const fullKey = "03abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const twinRecord = JSON.stringify({ btcPublicKey: fullKey });
    const result = simulateTwinLookup("SP5678", twinRecord);
    expect(result.stx_twin_btcpubkey_value_preview).toBe("03abcdef");
    expect(result.stx_twin_btcpubkey_value_preview!.length).toBe(8);
  });

  // btcPublicKey format classification
  describe("classifyBtcPubkeyFormat", () => {
    it("classifies 02-prefixed key as compressed_02", () => {
      expect(classifyBtcPubkeyFormat("02a1b2c3d4e5f6a7")).toBe("compressed_02");
    });
    it("classifies 03-prefixed key as compressed_03", () => {
      expect(classifyBtcPubkeyFormat("03a1b2c3d4e5f6a7")).toBe("compressed_03");
    });
    it("classifies 04-prefixed key as uncompressed_04", () => {
      expect(classifyBtcPubkeyFormat("04a1b2c3d4e5f6a7")).toBe("uncompressed_04");
    });
    it("classifies any other prefix as other", () => {
      expect(classifyBtcPubkeyFormat("00000000")).toBe("other");
      expect(classifyBtcPubkeyFormat("deadbeef")).toBe("other");
    });
  });
});
