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
    const result = await checkSenderRateLimit(kv, "SP1SENDER");
    expect(result.limited).toBe(false);
    expect(result.hadPriorFailure).toBe(false);
  });

  it("second request within the normal window is rate limited", async () => {
    await checkSenderRateLimit(kv, "SP1SENDER");
    const second = await checkSenderRateLimit(kv, "SP1SENDER");
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limited response has a valid ISO 8601 resetAt", async () => {
    await checkSenderRateLimit(kv, "SP2SENDER");
    const second = await checkSenderRateLimit(kv, "SP2SENDER");
    expect(second.limited).toBe(true);
    const ts = new Date(second.resetAt);
    expect(ts.getTime()).not.toBeNaN();
  });

  it("different senders have independent rate limit windows", async () => {
    await checkSenderRateLimit(kv, "SP1SENDER");
    const other = await checkSenderRateLimit(kv, "SP2DIFFERENT");
    expect(other.limited).toBe(false);
  });

  it("request is allowed after the window expires (simulated via KV delete)", async () => {
    const { kv: freshKV, store } = createMockKVWithOptions();
    // First request — consumes the window slot
    await checkSenderRateLimit(freshKV, "SP3SENDER");
    // Simulate window expiry by deleting the KV key
    const key = `${INBOX_SENDER_RATE_LIMIT_PREFIX}SP3SENDER`;
    store.delete(key);
    // Now a new window starts — should be allowed
    const afterExpiry = await checkSenderRateLimit(freshKV, "SP3SENDER");
    expect(afterExpiry.limited).toBe(false);
  });

  it("uses the normal TTL (10s) when no failure cache entry exists", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await checkSenderRateLimit(freshKV, "SP4SENDER");
    // The checkFixedWindowRateLimit puts the window entry; it uses the ttl as expirationTtl
    // when isNewWindow=true. At least one put call should use the normal TTL.
    const rateLimitPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}SP4SENDER`
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

  it("hadPriorFailure is true when payment failure cache is populated", async () => {
    await cachePaymentFailure(kv, "SP1FAILED", "INSUFFICIENT_FUNDS");
    const result = await checkSenderRateLimit(kv, "SP1FAILED");
    expect(result.hadPriorFailure).toBe(true);
  });

  it("first request after failure is allowed (not limited yet)", async () => {
    await cachePaymentFailure(kv, "SP2FAILED", "INSUFFICIENT_FUNDS");
    const result = await checkSenderRateLimit(kv, "SP2FAILED");
    expect(result.limited).toBe(false);
  });

  it("second request within the failure window is rate limited", async () => {
    await cachePaymentFailure(kv, "SP3FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(kv, "SP3FAILED");
    const second = await checkSenderRateLimit(kv, "SP3FAILED");
    expect(second.limited).toBe(true);
    expect(second.hadPriorFailure).toBe(true);
  });

  it("Retry-After is within the failure window (up to 60s)", async () => {
    await cachePaymentFailure(kv, "SP4FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(kv, "SP4FAILED");
    const second = await checkSenderRateLimit(kv, "SP4FAILED");
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(
      INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS
    );
  });

  it("uses the failure TTL (60s) when failure cache entry exists", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await cachePaymentFailure(freshKV, "SP5FAILED", "INSUFFICIENT_FUNDS");
    await checkSenderRateLimit(freshKV, "SP5FAILED");
    const rateLimitPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}SP5FAILED`
    );
    expect(rateLimitPuts.length).toBeGreaterThan(0);
    expect(rateLimitPuts[0].options?.expirationTtl).toBe(
      INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS
    );
  });

  it("sender without failure has normal TTL while failed sender has stricter TTL", async () => {
    const { kv: freshKV, putCalls } = createMockKVWithOptions();
    await cachePaymentFailure(freshKV, "SP6FAILED", "INSUFFICIENT_FUNDS");

    // Failed sender
    await checkSenderRateLimit(freshKV, "SP6FAILED");
    // Normal sender (no failure)
    await checkSenderRateLimit(freshKV, "SP6NORMAL");

    const failedPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}SP6FAILED`
    );
    const normalPuts = putCalls.filter((c) =>
      c.key === `${INBOX_SENDER_RATE_LIMIT_PREFIX}SP6NORMAL`
    );

    expect(failedPuts[0].options?.expirationTtl).toBe(INBOX_SENDER_RATE_LIMIT_FAILURE_TTL_SECONDS);
    expect(normalPuts[0].options?.expirationTtl).toBe(INBOX_SENDER_RATE_LIMIT_NORMAL_TTL_SECONDS);
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
    await expect(checkSenderRateLimit(throwingKV, "SP1THROW")).rejects.toThrow();
  });
});
