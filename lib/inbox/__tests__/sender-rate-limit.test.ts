import { describe, it, expect, beforeEach } from "vitest";
import { extractSenderStxAddress, checkSenderRateLimit } from "../sender-rate-limit";
import { cachePaymentFailure } from "../payment-cache";
import {
  INBOX_SENDER_RATE_LIMIT_PREFIX,
  INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS,
  INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS,
} from "../constants";
import {
  createMockKV,
  createMockKVWithOptions,
  createThrowingKV,
} from "./kv-mock";

// ---------------------------------------------------------------------------
// extractSenderStxAddress
// ---------------------------------------------------------------------------

describe("extractSenderStxAddress", () => {
  it("returns null for an empty string", () => {
    expect(extractSenderStxAddress("", "mainnet")).toBeNull();
  });

  it("returns null for a non-hex garbage string", () => {
    expect(extractSenderStxAddress("not-a-transaction", "mainnet")).toBeNull();
  });

  it("returns null for valid hex that is not a Stacks transaction", () => {
    // "deadbeef" is valid hex but not a Stacks serialized tx
    expect(extractSenderStxAddress("deadbeef", "mainnet")).toBeNull();
  });

  it("returns null for an all-zeros hex string (truncated/invalid tx)", () => {
    expect(extractSenderStxAddress("0000000000000000", "mainnet")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkSenderRateLimit — normal window (no prior failure)
// ---------------------------------------------------------------------------

describe("checkSenderRateLimit (normal window)", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("first request is allowed and hadPriorFailure is false", async () => {
    const result = await checkSenderRateLimit(kv, "key1");
    expect(result.limited).toBe(false);
    expect(result.hadPriorFailure).toBe(false);
  });

  it("second request within the normal window is rate limited", async () => {
    await checkSenderRateLimit(kv, "key1");
    const second = await checkSenderRateLimit(kv, "key1");
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limited response has a valid ISO 8601 resetAt", async () => {
    await checkSenderRateLimit(kv, "key2");
    const second = await checkSenderRateLimit(kv, "key2");
    expect(second.limited).toBe(true);
    const ts = new Date(second.resetAt);
    expect(ts.getTime()).not.toBeNaN();
  });

  it("different keys have independent rate limit windows", async () => {
    await checkSenderRateLimit(kv, "key1");
    const other = await checkSenderRateLimit(kv, "key2");
    expect(other.limited).toBe(false);
  });

  it("request is allowed after the window expires (simulated via KV delete)", async () => {
    const { kv: freshKV, store } = createMockKVWithOptions();
    // First request — consumes the window slot
    await checkSenderRateLimit(freshKV, "key3");
    // Simulate window expiry by deleting the KV key
    const key = `${INBOX_SENDER_RATE_LIMIT_PREFIX}key3`;
    store.delete(key);
    // Now a new window starts — should be allowed
    const afterExpiry = await checkSenderRateLimit(freshKV, "key3");
    expect(afterExpiry.limited).toBe(false);
  });

  it("uses the normal TTL (10s) when no sender address provided", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await checkSenderRateLimit(freshKV, "key4");
    const rateLimitPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}key4`
    );
    expect(rateLimitPuts.length).toBeGreaterThan(0);
    expect(rateLimitPuts[0].options?.expirationTtl).toBe(
      INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS
    );
  });

  it("uses the normal TTL when sender has no cached failure", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await checkSenderRateLimit(freshKV, "key5", "SP1CLEAN");
    const rateLimitPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}key5`
    );
    expect(rateLimitPuts.length).toBeGreaterThan(0);
    expect(rateLimitPuts[0].options?.expirationTtl).toBe(
      INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS
    );
  });
});

// ---------------------------------------------------------------------------
// checkSenderRateLimit — failure window (prior payment failure cached)
// ---------------------------------------------------------------------------

describe("checkSenderRateLimit (failure window after payment failure)", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("hadPriorFailure is true when sender has cached payment failure", async () => {
    await cachePaymentFailure(kv, "SP1FAILED", "INSUFFICIENT_FUNDS");
    const result = await checkSenderRateLimit(kv, "key1", "SP1FAILED");
    expect(result.hadPriorFailure).toBe(true);
  });

  it("first request after failure is allowed (not limited yet)", async () => {
    await cachePaymentFailure(kv, "SP2FAILED", "INSUFFICIENT_FUNDS");
    const result = await checkSenderRateLimit(kv, "key2", "SP2FAILED");
    expect(result.limited).toBe(false);
  });

  it("second request within the failure window is rate limited", async () => {
    await cachePaymentFailure(kv, "SP3FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(kv, "key3", "SP3FAILED");
    const second = await checkSenderRateLimit(kv, "key3", "SP3FAILED");
    expect(second.limited).toBe(true);
    expect(second.hadPriorFailure).toBe(true);
  });

  it("Retry-After is within the failure window (up to 60s)", async () => {
    await cachePaymentFailure(kv, "SP4FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(kv, "key4", "SP4FAILED");
    const second = await checkSenderRateLimit(kv, "key4", "SP4FAILED");
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(
      INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS
    );
  });

  it("uses the failure TTL (60s) when sender has cached failure", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await cachePaymentFailure(freshKV, "SP5FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(freshKV, "key5", "SP5FAILED");
    const rateLimitPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}key5`
    );
    expect(rateLimitPuts.length).toBeGreaterThan(0);
    expect(rateLimitPuts[0].options?.expirationTtl).toBe(
      INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS
    );
  });

  it("same rate key uses different TTLs based on sender failure state", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await cachePaymentFailure(freshKV, "SP6FAILED", "INSUFFICIENT_FUNDS");

    // Rate limit check with failed sender
    await checkSenderRateLimit(freshKV, "key-failed", "SP6FAILED");
    // Rate limit check with clean sender (no failure cache)
    await checkSenderRateLimit(freshKV, "key-normal", "SP6NORMAL");

    const failedPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}key-failed`
    );
    const normalPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}key-normal`
    );

    expect(failedPuts[0].options?.expirationTtl).toBe(INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS);
    expect(normalPuts[0].options?.expirationTtl).toBe(INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS);
  });

  it("hadPriorFailure is false when sender address is null", async () => {
    await cachePaymentFailure(kv, "SP7FAILED", "INSUFFICIENT_FUNDS");
    // Even though SP7FAILED has a cache entry, passing null skips the lookup
    const result = await checkSenderRateLimit(kv, "key7", null);
    expect(result.hadPriorFailure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSenderRateLimit — KV error propagation
// ---------------------------------------------------------------------------

describe("checkSenderRateLimit (KV error behavior)", () => {
  it("propagates KV errors (caller is responsible for fail-open handling)", async () => {
    const throwingKV = createThrowingKV();
    // getCachedPaymentFailure fails open (returns null), but checkFixedWindowRateLimit
    // does not catch KV errors — they propagate to the caller.
    await expect(checkSenderRateLimit(throwingKV, "key1")).rejects.toThrow();
  });
});
