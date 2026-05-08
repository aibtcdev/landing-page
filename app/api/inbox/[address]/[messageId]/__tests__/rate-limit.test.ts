/**
 * Regression tests for inbox mark-read PATCH rate-limit (Phase 0.6, #661).
 *
 * Key property: the per-IP bucket (RATE_LIMIT_MUTATING, key: inbox-mark-read:{ip})
 * runs BEFORE verifyBitcoinSignature so signature-verification DoS spam from one
 * IP gets clipped at the bucket limit. IP-keyed only: spoofing the `address`
 * path-param cannot bypass an exhausted IP quota.
 *
 * Tests call the real PATCH handler with mocked getCloudflareContext() and
 * mocked downstream functions so the test exercises the handler's actual call
 * order rather than a simulator that can drift.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../route";

// ---- module mocks --------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/inbox", () => ({
  getMessage: vi.fn(),
  getReply: vi.fn(),
  updateMessage: vi.fn(),
  getAgentInbox: vi.fn(),
  validateMarkRead: vi.fn(),
  buildMarkReadMessage: vi.fn(() => "Mark as Read | msg_123"),
  decrementUnreadCount: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  isLogsRPC: vi.fn(() => false),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(),
}));

// ---- imports after mocks -------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import { getMessage, validateMarkRead } from "@/lib/inbox";

// ---- helpers -------------------------------------------------------------

/** Minimal RateLimit binding mock with a controllable success value. */
function createRateLimitMock(success: boolean): RateLimit {
  return {
    limit: vi.fn(async (_opts: { key: string }) => ({ success })),
  } as unknown as RateLimit;
}

/** RateLimit binding mock that throws — simulates binding outage. */
function createThrowingRateLimitMock(): RateLimit {
  return {
    limit: vi.fn(async (_opts: { key: string }) => {
      throw new Error("binding unavailable");
    }),
  } as unknown as RateLimit;
}

/** Minimal valid mark-read PATCH body. */
const VALID_BODY = JSON.stringify({
  messageId: "msg_123_abc",
  signature: "sig123",
});

/**
 * Build a minimal NextRequest for the mark-read PATCH handler.
 */
function buildRequest(opts: { ip?: string; body?: string } = {}): NextRequest {
  const body = opts.body ?? VALID_BODY;
  const req = new NextRequest(
    "https://aibtc.com/api/inbox/bc1qtest/msg_123_abc",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        ...(opts.ip ? { "cf-connecting-ip": opts.ip } : {}),
      },
      body,
    }
  );
  return req;
}

/**
 * Wire up getCloudflareContext() mock to return the given env.
 */
function mockContext(env: Partial<CloudflareEnv>) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env: {
      VERIFIED_AGENTS: {} as KVNamespace,
      ...env,
    },
    ctx: {},
  });
}

// ---- test suite ----------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default stubs so tests that only care about IP-bucket behavior
  // don't need to stub every downstream path.
  (lookupAgent as Mock).mockResolvedValue(null);
  (getMessage as Mock).mockResolvedValue(null);
  (validateMarkRead as Mock).mockReturnValue({
    errors: null,
    data: { messageId: "msg_123_abc", signature: "sig123" },
  });
  (verifyBitcoinSignature as Mock).mockReturnValue({ valid: true, address: "bc1qtest" });
});

describe("inbox mark-read PATCH — IP rate limit blocks before verifyBitcoinSignature", () => {
  it("returns 429 when IP bucket is exhausted; verifyBitcoinSignature is NOT reached", async () => {
    const exhausted = createRateLimitMock(false);
    mockContext({ RATE_LIMIT_MUTATING: exhausted });

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    expect(resp.status).toBe(429);
    expect(verifyBitcoinSignature).not.toHaveBeenCalled();
    expect(exhausted.limit).toHaveBeenCalledTimes(1);
  });

  it("proceeds past IP check when quota has headroom; lookupAgent is reached", async () => {
    const passing = createRateLimitMock(true);
    mockContext({ RATE_LIMIT_MUTATING: passing });
    // Agent not found → 404, but that means we got past the rate limit
    (lookupAgent as Mock).mockResolvedValue(null);

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    expect(resp.status).not.toBe(429);
    expect(lookupAgent).toHaveBeenCalled();
  });

  it("calls limit() with the correct key format inbox-mark-read:{ip}", async () => {
    const limiter = createRateLimitMock(false);
    mockContext({ RATE_LIMIT_MUTATING: limiter });

    const req = buildRequest({ ip: "10.20.30.40" });
    await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    expect(limiter.limit).toHaveBeenCalledWith({ key: "inbox-mark-read:10.20.30.40" });
  });

  it("spoofed path address cannot bypass IP bucket — IP key is the only key", async () => {
    const exhausted = createRateLimitMock(false);

    const spoofedAddresses = [
      "bc1qspoofed1",
      "bc1qspoofed2",
      "bc1qlegitimate",
    ];

    for (const addr of spoofedAddresses) {
      // Re-apply mock so we can track calls per invocation
      (getCloudflareContext as Mock).mockResolvedValue({
        env: {
          VERIFIED_AGENTS: {} as KVNamespace,
          RATE_LIMIT_MUTATING: exhausted,
        },
        ctx: {},
      });

      const req = buildRequest({ ip: "1.2.3.4" });
      const resp = await PATCH(req, {
        params: Promise.resolve({ address: addr, messageId: "msg_123_abc" }),
      });

      expect(resp.status).toBe(429);
    }

    // Called once per address variation — key is always ip-keyed, not address-keyed
    expect(exhausted.limit).toHaveBeenCalledTimes(spoofedAddresses.length);
    for (const call of (exhausted.limit as Mock).mock.calls) {
      expect(call[0]).toEqual({ key: "inbox-mark-read:1.2.3.4" });
    }
  });

  it("no-ip header skips rate-limit check entirely; lookupAgent is reached", async () => {
    const limiter = createRateLimitMock(false); // would block, but won't be called
    mockContext({ RATE_LIMIT_MUTATING: limiter });
    (lookupAgent as Mock).mockResolvedValue(null);

    // No ip header
    const req = buildRequest({});
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    // Skipped rate limit → proceeds to lookupAgent → 404
    expect(resp.status).not.toBe(429);
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(lookupAgent).toHaveBeenCalled();
  });
});

describe("inbox mark-read PATCH — fail-closed / fail-open on binding error", () => {
  it("binding error in production (DEPLOY_ENV=production) fails closed — 429 returned", async () => {
    const throwing = createThrowingRateLimitMock();
    mockContext({
      DEPLOY_ENV: "production",
      RATE_LIMIT_MUTATING: throwing,
    });

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    expect(resp.status).toBe(429);
    expect(verifyBitcoinSignature).not.toHaveBeenCalled();
  });

  it("binding error in preview (DEPLOY_ENV=preview) fails closed — 429 returned", async () => {
    const throwing = createThrowingRateLimitMock();
    mockContext({
      DEPLOY_ENV: "preview",
      RATE_LIMIT_MUTATING: throwing,
    });

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    expect(resp.status).toBe(429);
    expect(verifyBitcoinSignature).not.toHaveBeenCalled();
  });

  it("binding error in dev (DEPLOY_ENV=undefined) fails open — request proceeds past IP check", async () => {
    const throwing = createThrowingRateLimitMock();
    mockContext({
      // DEPLOY_ENV omitted → undefined → fail open
      RATE_LIMIT_MUTATING: throwing,
    });
    (lookupAgent as Mock).mockResolvedValue(null);

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await PATCH(req, {
      params: Promise.resolve({ address: "bc1qtest", messageId: "msg_123_abc" }),
    });

    // Fails open → proceeds past IP check → agent not found → 404
    expect(resp.status).not.toBe(429);
    expect(lookupAgent).toHaveBeenCalled();
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
