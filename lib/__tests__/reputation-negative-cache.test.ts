/**
 * Tests for reputation fetch resilience: 60s negative-cache-on-timeout (issue
 * #795), cross-agent circuit breaker (Hiro budget exhaustion, issue #933), and
 * transient-vs-authoritative result discrimination (issue #958 Codex P2).
 *
 * Negative-cache behavior (original): on transient upstream error
 * (TimeoutError / 5xx), write a 60s per-agentId negative cache and return
 * a `{ transient: true, value: null }` result. Throwing here would create an
 * asymmetry between the first request (500) and subsequent requests within the
 * 60s window (200 from cached null) for the same polling client.
 *
 * Circuit-breaker behavior (added): when Hiro budget is globally exhausted,
 * a shared KV key is set for 60s. Subsequent calls for ANY agentId check this
 * key BEFORE calling callReadOnly — skipping the Hiro call entirely. This
 * stops the 56–441/day error storm caused by the competition sweep starving
 * the shared Hiro key budget. When the breaker is open, NO per-agentId KV
 * negative cache is written (the shared breaker key already gates all calls;
 * writing per-agent entries would pollute the cache with transient results
 * that look authoritative to later callers).
 *
 * Transient discrimination (issue #958): all results carry a `transient` flag.
 * Routes must not edge-cache responses where `transient: true`. A genuine
 * on-chain "no reputation" (`transient: false`) is still safely cacheable.
 *
 * Covers:
 *  (a) getReputationSummary: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, returns { transient: true, value: null }.
 *  (b) getReputationSummary: second call within 60s returns { transient: false,
 *      value: null } from the KV cache without hitting callReadOnly again.
 *  (c) getReputationFeedback: callReadOnly throws → setCachedReputationLookupFailed
 *      called with the correct key, returns { transient: true, value: empty }.
 *  (d) getReputationFeedback: cached negative returns { transient: false, value: empty }
 *      without a second Hiro call.
 *  (e) getReputationSummary: circuit open → callReadOnly NOT called, per-agentId
 *      negative cache NOT written, returns { transient: true, value: null }.
 *  (f) getReputationSummary: callReadOnly throws → setReputationCircuitOpen called
 *      (shared breaker set for all future agentIds).
 *  (g) getReputationFeedback: circuit open → callReadOnly NOT called, per-agentId
 *      negative cache NOT written, returns { transient: true, value: empty }.
 *  (h) getReputationSummary: genuine on-chain empty → { transient: false, value: null },
 *      per-agentId cache written (authoritative negative).
 *  (i) Breaker-open result is NOT equal to the authoritative empty shape that
 *      would be edge-cached: transient flag must differ.
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
import { callReadOnly, parseClarityValue } from "@/lib/identity/stacks-api";
import {
  getCachedReputation,
  setCachedReputation,
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

describe("getReputationSummary: TimeoutError → negative cache + transient null", () => {
  it("(a) calls setCachedReputationLookupFailed and returns transient null on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    const result = await getReputationSummary(42, undefined, kv);

    // Must be transient: route must NOT edge-cache this result
    expect(result).toEqual({ transient: true, value: null });
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "summary:42",
      kv,
      undefined
    );
  });
});

describe("getReputationSummary: cached negative returns authoritative (non-transient) null", () => {
  it("(b) returns { transient: false, value: null } from KV cache without calling callReadOnly again", async () => {
    const kv = buildMockKv();
    // Second call sees a cache hit (as if the 60s negative was already written)
    mockCacheHitNull();

    const result = await getReputationSummary(42, undefined, kv);

    // KV cache hit is authoritative — safe to edge-cache
    expect(result).toEqual({ transient: false, value: null });
    // callReadOnly must NOT be invoked — the cache short-circuited it
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});

// ---- getReputationFeedback --------------------------------------------------

describe("getReputationFeedback: TimeoutError → negative cache + transient empty", () => {
  it("(c) calls setCachedReputationLookupFailed and returns transient empty page on callReadOnly timeout", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(TIMEOUT_ERROR);

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    // Must be transient: route must NOT edge-cache this result
    expect(result).toEqual({ transient: true, value: { items: [], cursor: null } });
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "feedback:42:0",
      kv,
      undefined
    );
  });
});

describe("getReputationFeedback: cached negative returns authoritative (non-transient) empty", () => {
  it("(d) returns { transient: false, value: empty } from KV cache without calling callReadOnly again", async () => {
    const kv = buildMockKv();
    // When getCachedReputation returns {hit: true, value: null}, the function
    // returns the fallback empty response: { items: [], cursor: null }
    mockCacheHitNull();

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    // KV cache hit is authoritative — safe to edge-cache
    expect(result).toEqual({ transient: false, value: { items: [], cursor: null } });
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});

// ---- Circuit breaker -----------------------------------------------------------

describe("getReputationSummary: circuit open → short-circuits callReadOnly, no per-agent KV write", () => {
  it("(e) skips callReadOnly, does NOT write per-agentId negative cache, returns transient null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerOpen();

    const result = await getReputationSummary(42, undefined, kv);

    // Must be transient: route must NOT edge-cache this result
    expect(result).toEqual({ transient: true, value: null });
    // callReadOnly must NOT be called when the breaker is open
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    // Per-agentId KV negative cache must NOT be written for a breaker-open
    // fallback — writing it would pollute the per-agent cache with a transient
    // result that looks authoritative. The shared breaker key is the gate.
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
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
    // Per-agentId negative cache also written (bounds Hiro retries to 1/60s
    // on per-key recovery even if the shared breaker already healed)
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });
});

describe("getReputationFeedback: circuit open → short-circuits callReadOnly, no per-agent KV write", () => {
  it("(g) skips callReadOnly, does NOT write per-agentId negative cache, returns transient empty page", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerOpen();

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    // Must be transient: route must NOT edge-cache this result
    expect(result).toEqual({ transient: true, value: { items: [], cursor: null } });
    // callReadOnly must NOT be called when the breaker is open
    expect(callReadOnly as Mock).not.toHaveBeenCalled();
    // Per-agentId KV negative cache must NOT be written for a breaker-open fallback
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});

// ---- Transient vs. authoritative distinction (issue #958) -------------------

describe("getReputationSummary: genuine on-chain empty → authoritative, negatively cached", () => {
  it("(h) on-chain count=0 returns { transient: false, value: null } and writes authoritative cache", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerClosed();
    // Hiro succeeds but count is 0 — confirmed no reputation
    (callReadOnly as Mock).mockResolvedValue({ okay: true, result: "..." });
    (parseClarityValue as Mock).mockReturnValue({ count: "0", "summary-value": "0", "summary-value-decimals": "18" });

    const result = await getReputationSummary(42, undefined, kv);

    // Authoritative: this is safe to edge-cache for the full TTL
    expect(result).toEqual({ transient: false, value: null });
    // Authoritative negative cache written (not lookup-failed)
    expect(setCachedReputation as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputation as Mock).toHaveBeenCalledWith("summary:42", null, kv, undefined);
    expect(setCachedReputationLookupFailed as Mock).not.toHaveBeenCalled();
  });
});

describe("transient vs. authoritative: breaker-open result is marked transient", () => {
  it("(i) breaker-open transient flag differs from genuine-empty authoritative flag", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    mockBreakerOpen();

    const breakerResult = await getReputationSummary(42, undefined, kv);
    expect(breakerResult.transient).toBe(true);

    // Compare: a KV cache hit (authoritative) is non-transient
    mockBreakerClosed();
    mockCacheHitNull();
    const cachedResult = await getReputationSummary(42, undefined, kv);
    expect(cachedResult.transient).toBe(false);

    // The transient flag distinguishes the two — route can make correct cache decision
    expect(breakerResult.transient).not.toBe(cachedResult.transient);
  });
});
