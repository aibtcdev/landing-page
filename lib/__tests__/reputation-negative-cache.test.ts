/**
 * Tests for the 60s negative-cache-on-timeout behavior added to
 * getReputationSummary and getReputationFeedback (issue #795).
 *
 * Covers:
 *  (a) getReputationSummary: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, then rethrows.
 *  (b) getReputationSummary: second call within 60s returns cached null without
 *      hitting callReadOnly again.
 *  (c) getReputationFeedback: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, then rethrows.
 *  (d) getReputationFeedback: second call within 60s returns cached empty response
 *      without hitting callReadOnly again.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---- module mocks (declared before tested-module import) --------------------

vi.mock("@/lib/identity/stacks-api", () => ({
  callReadOnly: vi.fn(),
  parseClarityValue: vi.fn(),
}));

vi.mock("@/lib/identity/kv-cache", () => ({
  getCachedReputation: vi.fn(),
  setCachedReputation: vi.fn().mockResolvedValue(undefined),
  setCachedReputationLookupFailed: vi.fn().mockResolvedValue(undefined),
}));

// ---- imports ----------------------------------------------------------------

import { getReputationSummary, getReputationFeedback } from "@/lib/identity/reputation";
import { callReadOnly, parseClarityValue } from "@/lib/identity/stacks-api";
import { getCachedReputation, setCachedReputationLookupFailed } from "@/lib/identity/kv-cache";

// ---- helpers ----------------------------------------------------------------

function buildMockKv(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

/** Simulate a "cache miss" so the function proceeds to callReadOnly. */
function mockCacheMiss(): void {
  (getCachedReputation as Mock).mockResolvedValue({ hit: false });
}

/** Simulate a "cache hit with null" so the function returns without calling Hiro. */
function mockCacheHitNull(): void {
  (getCachedReputation as Mock).mockResolvedValue({ hit: true, value: null });
}

const TIMEOUT_ERROR = new Error(
  "TimeoutError: The operation was aborted due to timeout"
);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- getReputationSummary ---------------------------------------------------

describe("getReputationSummary: TimeoutError → negative cache + rethrow", () => {
  it("(a) calls setCachedReputationLookupFailed and rethrows on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    await expect(getReputationSummary(42, undefined, kv)).rejects.toThrow(
      "TimeoutError"
    );

    // The negative cache helper must be called with the right cache key
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "summary:42",
      kv,
      undefined
    );
  });
});

describe("getReputationSummary: cached negative prevents second Hiro call", () => {
  it("(b) returns null from cache on second call without calling callReadOnly again", async () => {
    const kv = buildMockKv();
    // Second call sees a cache hit (as if the 60s negative was already written)
    mockCacheHitNull();

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toBeNull();
    // callReadOnly must NOT be invoked — the cache short-circuited it
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});

// ---- getReputationFeedback --------------------------------------------------

describe("getReputationFeedback: TimeoutError → negative cache + rethrow", () => {
  it("(c) calls setCachedReputationLookupFailed and rethrows on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    await expect(getReputationFeedback(42, undefined, undefined, kv)).rejects.toThrow(
      "TimeoutError"
    );

    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "feedback:42:0",
      kv,
      undefined
    );
  });
});

describe("getReputationFeedback: cached negative prevents second Hiro call", () => {
  it("(d) returns empty response from cache on second call without calling callReadOnly again", async () => {
    const kv = buildMockKv();
    // When getCachedReputation returns {hit: true, value: null}, the function
    // returns the fallback empty response: { items: [], cursor: null }
    mockCacheHitNull();

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    expect(result).toEqual({ items: [], cursor: null });
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});
