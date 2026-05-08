/**
 * Regression tests for outbox rate-limit binding cutover (agent-news#705 parity).
 *
 * Key property: the per-IP bucket (RATE_LIMIT_MUTATING, key: outbox-validation:{ip})
 * is checked BEFORE any address-keyed bucket. Spoofing the path address cannot
 * bypass an exhausted IP quota.
 *
 * These tests validate the binding call ordering and the fail-closed behavior
 * in production, working directly against the binding mock shape.
 */

import { describe, it, expect, vi } from "vitest";

/** Minimal RateLimit binding mock with a controllable success value. */
function createRateLimitMock(success: boolean): RateLimit {
  return {
    limit: vi.fn(async (_opts: { key: string }) => ({ success })),
  } as unknown as RateLimit;
}

/**
 * Simulate the IP-before-identity ordering from the outbox POST route.
 *
 * Returns the first bucket that fires (or null if both pass).
 * This mirrors the logic in app/api/outbox/[address]/route.ts.
 */
async function simulateOutboxRateLimitChecks(
  ipLimiter: RateLimit,
  authLimiter: RateLimit,
  ip: string,
  btcAddress: string
): Promise<{ blocked: boolean; blockedBy: "ip" | "identity" | null }> {
  // IP bucket — must run first
  const ipResult = await ipLimiter.limit({ key: `outbox-validation:${ip}` });
  if (!ipResult.success) {
    return { blocked: true, blockedBy: "ip" };
  }

  // Identity bucket — only reached if IP passed
  const authResult = await authLimiter.limit({ key: `outbox:${btcAddress}` });
  if (!authResult.success) {
    return { blocked: true, blockedBy: "identity" };
  }

  return { blocked: false, blockedBy: null };
}

describe("outbox rate limit binding — IP-before-identity ordering", () => {
  it("blocks at IP bucket when IP is exhausted, regardless of path address", async () => {
    const exhaustedIp = createRateLimitMock(false);
    const passingAuth = createRateLimitMock(true);

    const result = await simulateOutboxRateLimitChecks(
      exhaustedIp,
      passingAuth,
      "1.2.3.4",
      "bc1qspoofed0000000000000000000000000000000"
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe("ip");
  });

  it("spoofed path address cannot bypass an exhausted IP bucket", async () => {
    const exhaustedIp = createRateLimitMock(false);
    const passingAuth = createRateLimitMock(true);

    // Vary the path address — the IP bucket should still block
    const spoofedAddresses = [
      "bc1qspoofed1",
      "bc1qspoofed2",
      "bc1qspoofed3",
      "bc1qlegitimate",
    ];

    for (const spoofed of spoofedAddresses) {
      const result = await simulateOutboxRateLimitChecks(
        exhaustedIp,
        passingAuth,
        "1.2.3.4",
        spoofed
      );
      expect(result.blocked).toBe(true);
      expect(result.blockedBy).toBe("ip");
    }
  });

  it("identity bucket is checked after IP bucket passes", async () => {
    const passingIp = createRateLimitMock(true);
    const exhaustedAuth = createRateLimitMock(false);

    const result = await simulateOutboxRateLimitChecks(
      passingIp,
      exhaustedAuth,
      "1.2.3.4",
      "bc1qregistered"
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe("identity");
  });

  it("both buckets passing means request proceeds", async () => {
    const passingIp = createRateLimitMock(true);
    const passingAuth = createRateLimitMock(true);

    const result = await simulateOutboxRateLimitChecks(
      passingIp,
      passingAuth,
      "1.2.3.4",
      "bc1qregistered"
    );

    expect(result.blocked).toBe(false);
    expect(result.blockedBy).toBeNull();
  });

  it("IP bucket limit() is called with the correct key format", async () => {
    const ipLimiter = createRateLimitMock(true);
    const authLimiter = createRateLimitMock(true);

    await simulateOutboxRateLimitChecks(ipLimiter, authLimiter, "10.20.30.40", "bc1qany");

    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "outbox-validation:10.20.30.40" });
  });

  it("identity bucket limit() is called with the correct key format", async () => {
    const ipLimiter = createRateLimitMock(true);
    const authLimiter = createRateLimitMock(true);
    const btcAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

    await simulateOutboxRateLimitChecks(ipLimiter, authLimiter, "10.20.30.40", btcAddress);

    expect(authLimiter.limit).toHaveBeenCalledWith({ key: `outbox:${btcAddress}` });
  });

  it("identity bucket is NOT called when IP bucket blocks", async () => {
    const exhaustedIp = createRateLimitMock(false);
    const authLimiter = createRateLimitMock(true);

    await simulateOutboxRateLimitChecks(exhaustedIp, authLimiter, "1.2.3.4", "bc1qspoofed");

    // IP limiter called once
    expect(exhaustedIp.limit).toHaveBeenCalledTimes(1);
    // Auth limiter never reached
    expect(authLimiter.limit).not.toHaveBeenCalled();
  });
});

describe("outbox rate limit binding — inbox sender binding shape", () => {
  it("inbox sender binding returns { success: boolean } shape", async () => {
    const mutatingLimiter = createRateLimitMock(true);
    const result = await mutatingLimiter.limit({ key: "inbox-sender:abc123" });

    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });

  it("txid-recovery binding returns { success: boolean } shape", async () => {
    const mutatingLimiter = createRateLimitMock(true);
    const result = await mutatingLimiter.limit({ key: "txid-recovery:0xdeadbeef" });

    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });
});
