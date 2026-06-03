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

// ---- Error classification: upstream vs. local ----------------------------------
//
// The circuit breaker must only open for upstream Hiro conditions (HTTP 429,
// 5xx, network/timeout). A local processing error (e.g. BigInt() on an
// unexpected Clarity response shape) must NOT open the global breaker — that
// would suppress reputation lookups for ALL agentIds for 60s when the cause
// is a local defect affecting only one agent.

const RATE_LIMIT_ERROR = new Error("Stacks API call failed: 429 Too Many Requests");
const SERVER_ERROR_500 = new Error("Stacks API call failed: 503 Service Unavailable");
// stacksApiFetch re-throws the native fetch() error on network failure.
// In Node.js and Cloudflare Workers, this is a TypeError with message "fetch failed".
const NETWORK_ERROR = new TypeError("fetch failed");
// AbortError is thrown when AbortSignal.timeout() fires (per-attempt timeout in stacksApiFetch).
const ABORT_ERROR = new Error("The operation was aborted");
Object.defineProperty(ABORT_ERROR, "name", { value: "AbortError" });
// A local BigInt parse error — simulates an unexpected Clarity shape where
// parseClarityValue succeeds but wadToNumber(summary["summary-value"]) throws
// because the value is not a valid integer string. This is NOT an upstream error.
const LOCAL_PARSE_ERROR = new TypeError("Cannot convert undefined to a BigInt");

describe("getReputationSummary: upstream errors open global circuit breaker", () => {
  it("(j) HTTP 429 opens the global breaker and returns transient null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(RATE_LIMIT_ERROR);

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toEqual({ transient: true, value: null });
    // Global breaker MUST be opened — this is an upstream Hiro condition
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledWith(kv, undefined);
    // Per-agentId negative cache also written
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });

  it("(k) HTTP 5xx opens the global breaker and returns transient null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(SERVER_ERROR_500);

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toEqual({ transient: true, value: null });
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });

  it("(l1) network/fetch-failed TypeError opens the global breaker and returns transient null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(NETWORK_ERROR);

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toEqual({ transient: true, value: null });
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });

  it("(l2) AbortError (per-attempt timeout) opens the global breaker and returns transient null", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(ABORT_ERROR);

    const result = await getReputationSummary(42, undefined, kv);

    expect(result).toEqual({ transient: true, value: null });
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });
});

describe("getReputationSummary: local processing errors do NOT open global circuit breaker", () => {
  it("(m) BigInt/parse error does NOT call setReputationCircuitOpen, scoped to this agentId only", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    // Simulate callReadOnly succeeding but parseClarityValue returning a shape
    // that causes wadToNumber (BigInt) to throw. We simulate this by having
    // callReadOnly resolve successfully and parseClarityValue return a non-zero
    // count with a bad summary-value that BigInt() cannot parse.
    (callReadOnly as Mock).mockResolvedValue({ okay: true, result: "0x..." });
    (parseClarityValue as Mock).mockReturnValue({
      count: "3",
      "summary-value": "not-a-number", // BigInt("not-a-number") throws SyntaxError
      "summary-value-decimals": "18",
    });

    // The actual BigInt throw would happen inside wadToNumber — simulate it as
    // a rejection from the callReadOnly mock chain to represent the error
    // propagating out of the try block. In real code, parseClarityValue is
    // called synchronously after callReadOnly, so any throw propagates to catch.
    // We use a fresh mock that throws a local error after callReadOnly resolves.
    (callReadOnly as Mock).mockResolvedValue({ okay: true, result: "0x..." });
    (parseClarityValue as Mock).mockImplementation(() => {
      throw LOCAL_PARSE_ERROR;
    });

    const result = await getReputationSummary(42, undefined, kv);

    // Still returns transient (not authoritative), but scoped to this agent
    expect(result).toEqual({ transient: true, value: null });
    // CRITICAL: global breaker must NOT be opened for a local parse error
    expect(setReputationCircuitOpen as Mock).not.toHaveBeenCalled();
    // Per-agentId negative cache is still written (limits retry to 1/60s for this agent)
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "summary:42",
      kv,
      undefined
    );
  });
});

describe("getReputationFeedback: upstream errors open global circuit breaker", () => {
  it("(n) HTTP 429 opens the global breaker and returns transient empty page", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    (callReadOnly as Mock).mockRejectedValue(RATE_LIMIT_ERROR);

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    expect(result).toEqual({ transient: true, value: { items: [], cursor: null } });
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledTimes(1);
    expect(setReputationCircuitOpen as Mock).toHaveBeenCalledWith(kv, undefined);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
  });
});

describe("getReputationFeedback: local processing errors do NOT open global circuit breaker", () => {
  it("(o) parse error does NOT call setReputationCircuitOpen, scoped to this agentId only", async () => {
    const kv = buildMockKv();
    mockCacheMiss();
    // Simulate callReadOnly succeeding but parseClarityValue returning a shape
    // that causes the items map() to throw (e.g. unexpected item structure).
    (callReadOnly as Mock).mockResolvedValue({ okay: true, result: "0x..." });
    (parseClarityValue as Mock).mockImplementation(() => {
      throw LOCAL_PARSE_ERROR;
    });

    const result = await getReputationFeedback(42, undefined, undefined, kv);

    expect(result).toEqual({ transient: true, value: { items: [], cursor: null } });
    // CRITICAL: global breaker must NOT be opened for a local parse error
    expect(setReputationCircuitOpen as Mock).not.toHaveBeenCalled();
    // Per-agentId negative cache is still written
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledTimes(1);
    expect(setCachedReputationLookupFailed as Mock).toHaveBeenCalledWith(
      "feedback:42:0",
      kv,
      undefined
    );
  });
});
