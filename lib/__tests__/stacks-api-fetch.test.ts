import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stacksApiFetch,
  extractRateLimitInfo,
  detect429,
} from "../stacks-api-fetch";
import type { Logger } from "../logging";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

/** Build a minimal Headers that can report the rate-limit fields. */
function mockHeaders(values: Record<string, string> = {}): Headers {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  } as unknown as Headers;
}

function createMockLogger(): Logger & {
  _events: Array<{ level: string; message: string; context?: unknown }>;
} {
  const events: Array<{ level: string; message: string; context?: unknown }> = [];
  const record = (level: string) => (msg: string, ctx?: unknown) => {
    events.push({ level, message: msg, context: ctx });
  };
  return {
    _events: events,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

describe("stacksApiFetch logger telemetry", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("emits stacksApi.rate_limit_remaining on every parseable response", async () => {
    const logger = createMockLogger();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.mainnet.hiro.so/v2/contracts/call-read/foo/bar/baz",
      headers: mockHeaders({
        "ratelimit-remaining": "123",
        "ratelimit-limit": "500",
        "ratelimit-reset": "42",
      }),
    });

    await stacksApiFetch(
      "https://api.mainnet.hiro.so/v2/contracts/call-read/foo/bar/baz",
      {},
      { logger }
    );

    const rlEvents = logger._events.filter(
      (e) => e.message === "stacksApi.rate_limit_remaining"
    );
    expect(rlEvents).toHaveLength(1);
    expect(rlEvents[0].context).toMatchObject({
      path: "/v2/contracts/call-read/foo/bar/baz",
      rlRemaining: 123,
      rlLimit: 500,
    });
  });

  it("emits stacksApi.approaching_rate_limit when remaining < 50", async () => {
    const logger = createMockLogger();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      headers: mockHeaders({
        "ratelimit-remaining": "10",
        "ratelimit-limit": "500",
      }),
    });

    await stacksApiFetch(
      "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      {},
      { logger }
    );

    const approaching = logger._events.filter(
      (e) => e.message === "stacksApi.approaching_rate_limit"
    );
    expect(approaching).toHaveLength(1);
    expect(approaching[0].level).toBe("warn");
    expect(approaching[0].context).toMatchObject({
      rlRemaining: 10,
      threshold: 50,
    });
  });

  it("does NOT emit approaching_rate_limit when remaining >= 50", async () => {
    const logger = createMockLogger();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      headers: mockHeaders({ "ratelimit-remaining": "100" }),
    });

    await stacksApiFetch(
      "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      {},
      { logger }
    );

    const approaching = logger._events.filter(
      (e) => e.message === "stacksApi.approaching_rate_limit"
    );
    expect(approaching).toHaveLength(0);
  });

  it("emits stacksApi.retry_budget_exhausted on sustained 429", async () => {
    const logger = createMockLogger();
    // Return 429 with Retry-After=0 every time to speed up test
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      url: "https://api.mainnet.hiro.so/extended/v1/tx/0x1",
      headers: mockHeaders({
        "ratelimit-remaining": "0",
        "retry-after": "0",
      }),
    });

    const response = await stacksApiFetch(
      "https://api.mainnet.hiro.so/extended/v1/tx/0x1",
      {},
      { retries429: 2, logger } // retries429 = 2 for a short test
    );

    expect(response.status).toBe(429);
    const exhausted = logger._events.filter(
      (e) => e.message === "stacksApi.retry_budget_exhausted"
    );
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].context).toMatchObject({
      budget: "429",
      status: 429,
    });
  });

  it("is silent when no logger is provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      headers: mockHeaders({ "ratelimit-remaining": "5" }),
    });

    // Should not throw, and should complete without emitting telemetry
    const response = await stacksApiFetch(
      "https://api.mainnet.hiro.so/extended/v1/tx/0xabc",
      {}
    );
    expect(response.status).toBe(200);
  });

  it("detect429 emits stacksApi.rate_limited via logger when status is 429", () => {
    const logger = createMockLogger();
    const response = {
      status: 429,
      url: "https://api.mainnet.hiro.so/x",
      headers: mockHeaders({ "cf-ray": "abc123" }),
    } as unknown as Response;

    const result = detect429(response, logger);
    expect(result.isRateLimited).toBe(true);
    const rateLimited = logger._events.find(
      (e) => e.message === "stacksApi.rate_limited"
    );
    expect(rateLimited).toBeDefined();
    expect(rateLimited?.context).toMatchObject({ cfRay: "abc123" });
  });

  it("extractRateLimitInfo returns parsed fields even without logger", () => {
    const response = {
      url: "https://api.mainnet.hiro.so/x",
      headers: mockHeaders({
        "ratelimit-remaining": "42",
        "ratelimit-limit": "500",
      }),
    } as unknown as Response;

    const info = extractRateLimitInfo(response);
    expect(info.remaining).toBe(42);
    expect(info.limit).toBe(500);
  });
});
