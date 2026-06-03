/**
 * Tests for reputation fetch resilience: 60s negative-cache-on-timeout (issue
 * #795) and cross-agent circuit breaker (Hiro budget exhaustion, issue #933).
 *
 * Negative-cache behavior (original): on transient upstream error
 * (TimeoutError / 5xx), write a 60s per-agentId negative cache and return
 * null/empty silently. Throwing here would create an asymmetry between the
 * first request (500) and subsequent requests within the 60s window (200 from
 * cached null) for the same polling client.
 *
 * Circuit-breaker behavior (added): when Hiro budget is globally exhausted,
 * a shared KV key is set for 60s. Subsequent calls for ANY agentId check this
 * key BEFORE calling callReadOnly — skipping the Hiro call entirely. This
 * stops the 56–441/day error storm caused by the competition sweep starving
 * the shared Hiro key budget.
 *
 * Covers:
 *  (a) getReputationSummary: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, returns null silently (no rethrow).
 *  (b) getReputationSummary: second call within 60s returns cached null
 *      without hitting callReadOnly again.
 *  (c) getReputationFeedback: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, returns empty page silently (no rethrow).
 *  (d) getReputationFeedback: cached negative prevents second Hiro call.
 *  (e) getReputationSummary: circuit open → callReadOnly NOT called, per-agentId
 *      negative cache written, returns null.
 *  (f) getReputationSummary: callReadOnly throws → setReputationCircuitOpen called
 *      (shared breaker set for all future agentIds).
 *  (g) getReputationFeedback: circuit open → callReadOnly NOT called, returns
 *      empty page { items: [], cursor: null }.
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
  isReputationCircuitOpen: vi.fn().mockResolvedValue(false),
  setReputationCircuitOpen: vi.fn().mockResolvedValue(undefined),
}));

// ---- imports ----------------------------------------------------------------

import { getReputationSummary, getReputationFeedback } from "@/lib/identity/reputation";
import { callReadOnly } from "@/lib/identity/stacks-api";
import {
  getCachedReputation,
  setCachedReputationLookupFailed,
  isReputationCircuitOpen,
  setReputationCircuitOpen,
} from "@/lib/identity/kv-cache";

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

/** Simulate the circuit breaker being open (Hiro budget exhausted). */
function mockBreakerOpen(): void {
  (isReputationCircuitOpen as Mock).mockResolvedValue(true);
}

/** Simulate the circuit breaker being closed (default state). */
function mockBreakerClosed(): void {
  (isReputationCircuitOpen as Mock).mockResolvedValue(false);
}

const TIMEOUT_ERROR = new Error(
  "TimeoutError: The operation was aborted due to timeout"
);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: breaker closed so existing tests don't need to opt in
  mockBreakerClosed();
});

// ---- getReputationSummary ---------------------------------------------------

describe("getReputationSummary: TimeoutError → negative cache + silent null", () => {
  it("(a) calls setCachedReputationLookupFailed and returns null on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toBeNull();
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

describe("getReputationFeedback: TimeoutError → negative cache + silent empty", () => {
  it("(c) calls setCachedReputationLookupFailed and returns empty page on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    expect(result).toEqual({ items: [], cursor: null });
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

// ---- Circuit breaker -----------------------------------------------------------

describe("getReputationSummary: circuit open → short-circuits callReadOnly", () => {
  it("(e) skips callReadOnly, writes per-agentId negative cache, returns null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerOpen();

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toBeNull();
    // callReadOnly must NOT be called when the breaker is open
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    // Per-agentId negative cache written so this specific key also short-circuits
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "summary:42",
      kv,
      undefined
    );
  });
});

describe("getReputationSummary: callReadOnly failure opens shared circuit breaker", () => {
  it("(f) calls setReputationCircuitOpen when callReadOnly throws", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    await getReputationSummary(42, undefined, kv);

    // The shared circuit breaker must be opened so future calls for ANY agentId skip Hiro
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledWith(kv, undefined);
    // Per-agentId negative cache also written (pre-existing behavior)
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });
});

describe("getReputationFeedback: circuit open → short-circuits callReadOnly", () => {
  it("(g) skips callReadOnly, writes per-agentId negative cache, returns empty page", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerOpen();

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    expect(result).toEqual({ items: [], cursor: null });
    // callReadOnly must NOT be called when the breaker is open
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    // Per-agentId negative cache written
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "feedback:42:0",
      kv,
      undefined
    );
  });
});
