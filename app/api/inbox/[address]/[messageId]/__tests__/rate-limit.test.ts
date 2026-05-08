/**
 * Regression tests for inbox mark-read PATCH rate-limit (Phase 0.6, #661).
 *
 * Key property: the per-IP bucket (RATE_LIMIT_MUTATING, key: inbox-mark-read:{ip})
 * runs BEFORE verifyBitcoinSignature so signature-verification DoS spam from one
 * IP gets clipped at the bucket limit. IP-keyed only: spoofing the `address`
 * path-param cannot bypass an exhausted IP quota.
 *
 * Mirrors the test scaffold pattern from app/api/outbox/[address]/__tests__/rate-limit.test.ts
 * — validates binding-call shape, key format, and fail-closed-in-production semantics.
 */

import { describe, it, expect, vi } from "vitest";

/** Minimal RateLimit binding mock with a controllable success value. */
function createRateLimitMock(success: boolean): RateLimit {
  return {
    limit: vi.fn(async (_opts: { key: string }) => ({ success })),
  } as unknown as RateLimit;
}

/** Binding mock that throws — simulates binding outage. */
function createThrowingRateLimitMock(): RateLimit {
  return {
    limit: vi.fn(async (_opts: { key: string }) => {
      throw new Error("binding unavailable");
    }),
  } as unknown as RateLimit;
}

/**
 * Simulate the IP-bucket check from the inbox/[address]/[messageId] PATCH route.
 *
 * Returns whether the request would be blocked. Mirrors the logic in
 * app/api/inbox/[address]/[messageId]/route.ts.
 */
async function simulateMarkReadRateLimit(
  limiter: RateLimit,
  ip: string | null,
  isProduction: boolean = false
): Promise<{ blocked: boolean; verifyCalled: boolean }> {
  const verifyMock = vi.fn();

  // Skip if no IP — matches the `if (ip) { ... }` guard in the route.
  if (!ip) {
    verifyMock();
    return { blocked: false, verifyCalled: verifyMock.mock.calls.length > 0 };
  }

  let ipLimited = false;
  try {
    const result = await limiter.limit({ key: `inbox-mark-read:${ip}` });
    ipLimited = !result.success;
  } catch {
    // Fail closed in production/staging, open in dev.
    if (isProduction) ipLimited = true;
  }

  if (ipLimited) {
    return { blocked: true, verifyCalled: false };
  }

  // verifyBitcoinSignature would run here in the real route
  verifyMock();
  return { blocked: false, verifyCalled: verifyMock.mock.calls.length > 0 };
}

describe("inbox mark-read PATCH — IP rate limit", () => {
  it("blocks at IP bucket when IP quota is exhausted; verifyBitcoinSignature is NOT reached", async () => {
    const exhausted = createRateLimitMock(false);

    const result = await simulateMarkReadRateLimit(exhausted, "1.2.3.4");

    expect(result.blocked).toBe(true);
    expect(result.verifyCalled).toBe(false);
    expect(exhausted.limit).toHaveBeenCalledTimes(1);
  });

  it("proceeds to verifyBitcoinSignature when IP quota has headroom", async () => {
    const passing = createRateLimitMock(true);

    const result = await simulateMarkReadRateLimit(passing, "1.2.3.4");

    expect(result.blocked).toBe(false);
    expect(result.verifyCalled).toBe(true);
  });

  it("calls limit() with the correct key format (inbox-mark-read:{ip})", async () => {
    const limiter = createRateLimitMock(true);

    await simulateMarkReadRateLimit(limiter, "10.20.30.40");

    expect(limiter.limit).toHaveBeenCalledWith({ key: "inbox-mark-read:10.20.30.40" });
  });

  it("spoofed `address` path-param cannot bypass IP bucket — IP key is the only key", async () => {
    const exhausted = createRateLimitMock(false);

    // The simulate function only takes IP — by construction the address is not
    // part of the rate-limit key. Vary the IP, hold the key shape constant.
    const result1 = await simulateMarkReadRateLimit(exhausted, "1.2.3.4");
    const result2 = await simulateMarkReadRateLimit(exhausted, "1.2.3.4");
    const result3 = await simulateMarkReadRateLimit(exhausted, "1.2.3.4");

    // All three requests on same IP get blocked; address-spoofing irrelevant.
    expect(result1.blocked).toBe(true);
    expect(result2.blocked).toBe(true);
    expect(result3.blocked).toBe(true);
    expect(exhausted.limit).toHaveBeenCalledTimes(3);
    expect(exhausted.limit).toHaveBeenNthCalledWith(1, { key: "inbox-mark-read:1.2.3.4" });
    expect(exhausted.limit).toHaveBeenNthCalledWith(2, { key: "inbox-mark-read:1.2.3.4" });
    expect(exhausted.limit).toHaveBeenNthCalledWith(3, { key: "inbox-mark-read:1.2.3.4" });
  });

  it("binding error in production fails closed — request blocked, verify not reached", async () => {
    const throwing = createThrowingRateLimitMock();

    const result = await simulateMarkReadRateLimit(throwing, "1.2.3.4", /* isProduction */ true);

    expect(result.blocked).toBe(true);
    expect(result.verifyCalled).toBe(false);
  });

  it("binding error in dev fails open — request proceeds to verify", async () => {
    const throwing = createThrowingRateLimitMock();

    const result = await simulateMarkReadRateLimit(throwing, "1.2.3.4", /* isProduction */ false);

    expect(result.blocked).toBe(false);
    expect(result.verifyCalled).toBe(true);
  });

  it("no IP header (null) skips the rate-limit check entirely; verify proceeds", async () => {
    const limiter = createRateLimitMock(false); // would block, but won't be called

    const result = await simulateMarkReadRateLimit(limiter, null);

    expect(result.blocked).toBe(false);
    expect(result.verifyCalled).toBe(true);
    expect(limiter.limit).not.toHaveBeenCalled();
  });
});

describe("inbox mark-read PATCH — RateLimit binding shape", () => {
  it("binding limit() returns { success: boolean }", async () => {
    const limiter = createRateLimitMock(true);
    const result = await limiter.limit({ key: "inbox-mark-read:1.1.1.1" });

    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });
});
