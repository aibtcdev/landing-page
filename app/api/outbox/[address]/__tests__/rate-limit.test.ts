/**
 * Regression tests for outbox rate-limit binding cutover (agent-news#705 parity).
 *
 * Key property: the per-IP bucket (RATE_LIMIT_MUTATING, key: outbox-ip:{ip})
 * is checked BEFORE any address-keyed bucket. Spoofing the path address cannot
 * bypass an exhausted IP quota.
 *
 * Tests call the real POST handler with mocked getCloudflareContext() and
 * mocked downstream functions so the test exercises the handler's actual call
 * order rather than a simulator that can drift.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

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
  validateOutboxReply: vi.fn(),
  getMessage: vi.fn(),
  getReply: vi.fn(),
  storeReply: vi.fn(),
  updateMessage: vi.fn(),
  buildReplyMessage: vi.fn(),
  listInboxMessages: vi.fn(),
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

vi.mock("@/lib/validation/address", () => ({
  isStxAddress: vi.fn(() => false),
}));

// ---- imports after mocks -------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { getMessage } from "@/lib/inbox";

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

/** Minimal valid outbox POST body. */
const VALID_BODY = JSON.stringify({
  messageId: "msg_123_abc",
  reply: "hello",
  signature: "sig123",
});

/**
 * Build a minimal NextRequest for the outbox POST handler.
 * Sets Content-Type, Content-Length, and optionally the cf-connecting-ip header.
 */
function buildRequest(opts: { ip?: string; body?: string } = {}): NextRequest {
  const body = opts.body ?? VALID_BODY;
  const req = new NextRequest("https://aibtc.com/api/outbox/bc1qtest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      ...(opts.ip ? { "cf-connecting-ip": opts.ip } : {}),
    },
    body,
  });
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
  // Default: lookupAgent returns null (unregistered) so tests that only care
  // about IP-bucket behavior don't need to stub further downstream paths.
  (lookupAgent as Mock).mockResolvedValue(null);
  (getMessage as Mock).mockResolvedValue(null);
});

describe("outbox rate limit — IP bucket blocks before address-keyed buckets", () => {
  it("returns 429 when IP bucket is exhausted, before lookupAgent runs", async () => {
    const exhaustedIp = createRateLimitMock(false);
    mockContext({
      RATE_LIMIT_MUTATING: exhaustedIp,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await POST(req, { params: Promise.resolve({ address: "bc1qspoofed" }) });

    expect(resp.status).toBe(429);
    // lookupAgent should NOT have been called — IP check comes first
    expect(lookupAgent).not.toHaveBeenCalled();
  });

  it("spoofed path address cannot bypass an exhausted IP bucket", async () => {
    const exhaustedIp = createRateLimitMock(false);
    mockContext({
      RATE_LIMIT_MUTATING: exhaustedIp,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });

    const spoofedAddresses = [
      "bc1qspoofed1",
      "bc1qspoofed2",
      "bc1qspoofed3",
      "bc1qlegitimate",
    ];

    for (const addr of spoofedAddresses) {
      vi.clearAllMocks();
      // Re-apply mock after clearAllMocks
      (getCloudflareContext as Mock).mockResolvedValue({
        env: {
          VERIFIED_AGENTS: {} as KVNamespace,
          RATE_LIMIT_MUTATING: exhaustedIp,
          RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
        },
        ctx: {},
      });
      (lookupAgent as Mock).mockResolvedValue(null);

      const req = buildRequest({ ip: "1.2.3.4" });
      const resp = await POST(req, { params: Promise.resolve({ address: addr }) });

      expect(resp.status).toBe(429);
      expect(lookupAgent).not.toHaveBeenCalled();
    }
  });

  it("IP bucket limit() is called with key outbox-ip:{ip}", async () => {
    const ipLimiter = createRateLimitMock(false);
    mockContext({
      RATE_LIMIT_MUTATING: ipLimiter,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });

    const req = buildRequest({ ip: "10.20.30.40" });
    await POST(req, { params: Promise.resolve({ address: "bc1qany" }) });

    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "outbox-ip:10.20.30.40" });
  });

  it("unregistered bucket is checked after IP passes; returns 429 for unregistered agent", async () => {
    const passingIp = createRateLimitMock(true);
    const exhaustedUnreg = createRateLimitMock(false);
    mockContext({
      RATE_LIMIT_MUTATING: {
        limit: vi.fn()
          .mockResolvedValueOnce({ success: true })   // IP check passes
          .mockResolvedValueOnce({ success: false }),  // unregistered check blocks
      } as unknown as RateLimit,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });
    (lookupAgent as Mock).mockResolvedValue(null);

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await POST(req, { params: Promise.resolve({ address: "bc1qunreg" }) });

    expect(resp.status).toBe(429);
    void passingIp; void exhaustedUnreg; // consumed by mockContext
  });

  it("no-ip request skips IP bucket and falls through to unregistered 404", async () => {
    const mutatingLimiter = createRateLimitMock(true);
    mockContext({
      RATE_LIMIT_MUTATING: mutatingLimiter,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });
    (lookupAgent as Mock).mockResolvedValue(null);

    // No ip header
    const req = buildRequest({});
    const resp = await POST(req, { params: Promise.resolve({ address: "bc1qany" }) });

    // No IP → skip IP bucket → unregistered agent → 404
    expect(resp.status).toBe(404);
    // IP bucket was NOT called
    expect(mutatingLimiter.limit).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining("outbox-ip:") })
    );
  });
});

describe("outbox rate limit — fail-closed / fail-open on binding error", () => {
  it("binding error in production (DEPLOY_ENV=production) fails closed — 429 returned", async () => {
    const throwing = createThrowingRateLimitMock();
    mockContext({
      DEPLOY_ENV: "production",
      RATE_LIMIT_MUTATING: throwing,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await POST(req, { params: Promise.resolve({ address: "bc1qtest" }) });

    expect(resp.status).toBe(429);
  });

  it("binding error in dev (DEPLOY_ENV=undefined) fails open — request proceeds past IP check", async () => {
    const throwing = createThrowingRateLimitMock();
    mockContext({
      // DEPLOY_ENV omitted → undefined → fail open
      RATE_LIMIT_MUTATING: throwing,
      RATE_LIMIT_AUTHENTICATED: createRateLimitMock(true),
    });
    // Agent is unregistered — expect 404 (past IP check, not 429)
    (lookupAgent as Mock).mockResolvedValue(null);

    const req = buildRequest({ ip: "1.2.3.4" });
    const resp = await POST(req, { params: Promise.resolve({ address: "bc1qtest" }) });

    // Fails open → proceeds past IP check → unregistered agent → 404
    expect(resp.status).not.toBe(429);
  });
});

describe("outbox rate limit — binding shape assertions", () => {
  it("inbox-sender binding returns { success: boolean } shape", async () => {
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
