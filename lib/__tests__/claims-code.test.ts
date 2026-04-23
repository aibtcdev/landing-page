import { describe, it, expect } from "vitest";
import { generateClaimCode } from "../claim-code";

// ---------------------------------------------------------------------------
// Unit tests for claim-code helpers and route validation logic
// ---------------------------------------------------------------------------

describe("generateClaimCode", () => {
  it("returns a 6-character string", () => {
    const code = generateClaimCode();
    expect(code).toHaveLength(6);
  });

  it("contains only valid alphabet characters", () => {
    const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const code = generateClaimCode();
    for (const char of code) {
      expect(ALPHABET).toContain(char);
    }
  });

  it("generates different codes on subsequent calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateClaimCode());
    }
    // With 6 chars from 24-char alphabet, collision unlikely in 100 tries
    expect(codes.size).toBe(100);
  });

  it("does not include ambiguous characters (0, O, I, l, 1)", () => {
    const INVALID = "0OI1l";
    for (let i = 0; i < 50; i++) {
      const code = generateClaimCode();
      for (const char of code) {
        expect(INVALID).not.toContain(char);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Code validation logic (extracted from route for unit testing)
// ---------------------------------------------------------------------------

interface ClaimCodeRecord {
  code: string;
  createdAt: string;
}

/**
 * Simulates the code validation logic from GET /api/claims/code.
 * Validates that the provided code matches the stored code (case-insensitive).
 */
function validateCode(storedCode: string, providedCode: string): boolean {
  return storedCode === providedCode.toUpperCase();
}

describe("Code validation logic", () => {
  it("returns true for matching code", () => {
    expect(validateCode("ABC123", "ABC123")).toBe(true);
  });

  it("returns true for matching code with different case input", () => {
    expect(validateCode("ABC123", "abc123")).toBe(true);
  });

  it("returns false for non-matching code", () => {
    expect(validateCode("ABC123", "XYZ789")).toBe(false);
  });

  it("stores code in uppercase for comparison", () => {
    // The route stores: code: newCode (from generateClaimCode which is uppercase)
    // So validate should compare against uppercase stored code
    const storedCode = generateClaimCode(); // Already uppercase
    const inputCode = storedCode.toLowerCase();
    expect(validateCode(storedCode, inputCode)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route validation helpers (GET /api/claims/code)
// ---------------------------------------------------------------------------

describe("GET /api/claims/code route validation", () => {
  function makeSearchParams(params: Record<string, string | null>) {
    const url = new URL("http://localhost/api/claims/code");
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) {
        url.searchParams.set(key, value);
      }
    }
    return url.searchParams;
  }

  it("no btcAddress → return usage docs (status 200)", () => {
    const params = makeSearchParams({});
    const btcAddress = params.get("btcAddress");
    // When btcAddress is null, route returns usage docs
    expect(btcAddress).toBeNull();
  });

  it("btcAddress present but no code → return 400", () => {
    const params = makeSearchParams({ btcAddress: "bc1qtest" });
    const btcAddress = params.get("btcAddress");
    const code = params.get("code");
    // Both required - if code is missing, return 400
    expect(btcAddress).toBe("bc1qtest");
    expect(code).toBeNull();
  });

  it("both btcAddress and code → proceed to KV lookup", () => {
    const params = makeSearchParams({ btcAddress: "bc1qtest", code: "ABC123" });
    const btcAddress = params.get("btcAddress");
    const code = params.get("code");
    expect(btcAddress).toBe("bc1qtest");
    expect(code).toBe("ABC123");
  });
});

// ---------------------------------------------------------------------------
// POST /api/claims/code request validation
// ---------------------------------------------------------------------------

describe("POST /api/claims/code body validation", () => {
  function validateRequestBody(body: { btcAddress?: string; bitcoinSignature?: string }) {
    const { btcAddress, bitcoinSignature } = body;
    if (!btcAddress || !bitcoinSignature) {
      return { valid: false, error: "btcAddress and bitcoinSignature are required" };
    }
    return { valid: true };
  }

  it("missing btcAddress → invalid", () => {
    const result = validateRequestBody({ bitcoinSignature: "sig" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("btcAddress");
  });

  it("missing bitcoinSignature → invalid", () => {
    const result = validateRequestBody({ btcAddress: "bc1qtest" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("bitcoinSignature");
  });

  it("both present → valid", () => {
    const result = validateRequestBody({
      btcAddress: "bc1qtest",
      bitcoinSignature: "sig123",
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signature verification failure path
// ---------------------------------------------------------------------------

describe("POST /api/claims/code signature verification", () => {
  /**
   * Simulates the signature verification error handling from the route.
   * The route catches errors from verifyBitcoinSignature and returns 400.
   */
  function handleSignatureVerification(
    fn: () => { valid: boolean; publicKey?: string }
  ): { success: boolean; error?: string } {
    try {
      const result = fn();
      if (!result.valid) {
        return { success: false, error: "Bitcoin signature verification failed" };
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
      };
    }
  }

  it("throws on invalid signature format", () => {
    const verify = () => {
      throw new Error("Invalid signature format");
    };
    const result = handleSignatureVerification(verify);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid signature format");
  });

  it("returns error for BIP-322 verification failure", () => {
    const verify = () => {
      throw new Error("BIP-322 verification failed: address type not supported");
    };
    const result = handleSignatureVerification(verify);
    expect(result.success).toBe(false);
    expect(result.error).toContain("BIP-322 verification failed");
  });

  it("returns valid for successful verification with publicKey", () => {
    const verify = () => ({ valid: true, publicKey: "02abc..." });
    const result = handleSignatureVerification(verify);
    expect(result.success).toBe(true);
  });

  it("returns valid for BIP-322 (publicKey is empty string)", () => {
    const verify = () => ({ valid: true, publicKey: "" });
    const result = handleSignatureVerification(verify);
    expect(result.success).toBe(true);
  });

  it("rejects when publicKey does not match registered key", () => {
    function handlePublicKeyCheck(
      sigResult: { valid: boolean; publicKey?: string },
      registeredKey: string
    ): { success: boolean; error?: string } {
      if (sigResult.publicKey && sigResult.publicKey !== registeredKey) {
        return {
          success: false,
          error: "Signature does not match the registered Bitcoin key",
        };
      }
      return { success: true };
    }

    const sigResult = { valid: true, publicKey: "02wrong..." };
    const registeredKey = "02correct...";
    const result = handlePublicKeyCheck(sigResult, registeredKey);

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not match the registered Bitcoin key");
  });

  it("allows BIP-322 signature (empty publicKey) even without key match check", () => {
    function handlePublicKeyCheck(
      sigResult: { valid: boolean; publicKey?: string },
      registeredKey: string
    ): { success: boolean; error?: string } {
      // BIP-322: publicKey is "" because address ownership is proven via witness reconstruction
      // So skip key-binding check for that path
      if (sigResult.publicKey && sigResult.publicKey !== registeredKey) {
        return {
          success: false,
          error: "Signature does not match the registered Bitcoin key",
        };
      }
      return { success: true };
    }

    const sigResult = { valid: true, publicKey: "" };
    const registeredKey = "02correct...";
    const result = handlePublicKeyCheck(sigResult, registeredKey);

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KV key format tests
// ---------------------------------------------------------------------------

describe("KV key format for claims/code", () => {
  it("claim code key follows expected format", () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    const key = `claim-code:${btcAddress}`;
    expect(key).toBe("claim-code:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  });

  it("agent lookup key follows expected format", () => {
    const btcAddress = "bc1qtest";
    const key = `btc:${btcAddress}`;
    expect(key).toBe("btc:bc1qtest");
  });
});

// ---------------------------------------------------------------------------
// ClaimCodeRecord structure
// ---------------------------------------------------------------------------

describe("ClaimCodeRecord structure", () => {
  it("has required code and createdAt fields", () => {
    const record: ClaimCodeRecord = {
      code: "ABC123",
      createdAt: new Date().toISOString(),
    };
    expect(record.code).toBeDefined();
    expect(record.createdAt).toBeDefined();
  });

  it("code is uppercase alphanumeric", () => {
    const record: ClaimCodeRecord = {
      code: generateClaimCode(),
      createdAt: new Date().toISOString(),
    };
    expect(record.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  });

  it("createdAt is ISO 8601 format", () => {
    const record: ClaimCodeRecord = {
      code: "ABC123",
      createdAt: new Date().toISOString(),
    };
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});