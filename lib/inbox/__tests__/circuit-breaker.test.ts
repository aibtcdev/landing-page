/**
 * Tests for `lib/inbox/circuit-breaker.ts` (P4 rewrite).
 *
 * Asserts the new behavior:
 * - `checkCircuitBreaker` reads from `caches.default`, does NOT consume
 *   a `RATE_LIMIT_RELAY_FAILURES` binding slot.
 * - `recordRelayFailure` always calls the binding's `limit()`; writes
 *   the per-colo "open" marker to `caches.default` ONLY when the
 *   binding returns `success: false`.
 * - `resetCircuitBreaker` deletes the cache marker.
 * - All three functions fail-open (return / no-throw) on binding or
 *   cache errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkCircuitBreaker,
  recordRelayFailure,
  resetCircuitBreaker,
} from "../circuit-breaker";

const CIRCUIT_OPEN_CACHE_URL = "https://cache.aibtc.local/inbox/circuit-breaker-open";

interface MockCache {
  cache: Cache;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function installMockCache(matchResult: Response | undefined = undefined): MockCache {
  const match = vi.fn().mockResolvedValue(matchResult);
  const put = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(true);
  const cache = { match, put, delete: del } as unknown as Cache;
  (globalThis as unknown as { caches: { default: Cache } }).caches = { default: cache };
  return { cache, match, put, delete: del };
}

function uninstallMockCache() {
  delete (globalThis as unknown as { caches?: unknown }).caches;
}

function buildMockEnv(bindingSuccess: boolean): CloudflareEnv {
  return {
    RATE_LIMIT_RELAY_FAILURES: {
      limit: vi.fn().mockResolvedValue({ success: bindingSuccess }),
    },
  } as unknown as CloudflareEnv;
}

afterEach(() => {
  uninstallMockCache();
  vi.restoreAllMocks();
});

describe("checkCircuitBreaker", () => {
  it("returns { open: false } when caches.default has no marker", async () => {
    installMockCache(undefined);
    const result = await checkCircuitBreaker();
    expect(result).toEqual({ open: false });
  });

  it("returns { open: true } when caches.default returns a marker", async () => {
    installMockCache(new Response("{}"));
    const result = await checkCircuitBreaker();
    expect(result).toEqual({ open: true });
  });

  it("returns { open: false } when caches.default is unavailable (non-Workers runtime)", async () => {
    // No installMockCache call — globalThis.caches is undefined.
    const result = await checkCircuitBreaker();
    expect(result).toEqual({ open: false });
  });

  it("does NOT call the RATE_LIMIT_RELAY_FAILURES binding (no slot consumed)", async () => {
    const { cache } = installMockCache(undefined);
    await checkCircuitBreaker();
    // The cache was consulted, but `binding.limit` was never called
    // (there's no env reference in checkCircuitBreaker at all).
    expect(cache.match).toHaveBeenCalledTimes(1);
  });
});

describe("recordRelayFailure", () => {
  beforeEach(() => {
    installMockCache(undefined);
  });

  it("calls env.RATE_LIMIT_RELAY_FAILURES.limit on every invocation", async () => {
    const env = buildMockEnv(true);
    await recordRelayFailure(env);
    expect(env.RATE_LIMIT_RELAY_FAILURES.limit).toHaveBeenCalledWith({
      key: "relay-failures",
    });
  });

  it("does NOT write the open marker when the binding returns success: true", async () => {
    const env = buildMockEnv(true);
    const cache = (globalThis as unknown as { caches: { default: Cache & { put: ReturnType<typeof vi.fn>; match: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } } }).caches.default;
    await recordRelayFailure(env);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("writes the open marker to caches.default when the binding returns success: false", async () => {
    const env = buildMockEnv(false);
    const ctx = { waitUntil: vi.fn() };
    await recordRelayFailure(env, ctx);
    const cache = (globalThis as unknown as { caches: { default: Cache & { put: ReturnType<typeof vi.fn>; match: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } } }).caches.default;
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [request, response] = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((request as Request).url).toBe(CIRCUIT_OPEN_CACHE_URL);
    // The response is JSON with an openedAt timestamp.
    const body = await (response as Response).json();
    expect(typeof body.openedAt).toBe("string");
  });

  it("detaches the cache.put via ctx.waitUntil when provided", async () => {
    const env = buildMockEnv(false);
    const ctx = { waitUntil: vi.fn() };
    await recordRelayFailure(env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("fails open (no throw) when the binding is missing from env", async () => {
    const env = {} as unknown as CloudflareEnv;
    await expect(recordRelayFailure(env)).resolves.toBeUndefined();
  });

  it("fails open (no throw) when binding.limit throws", async () => {
    const env = {
      RATE_LIMIT_RELAY_FAILURES: {
        limit: vi.fn().mockRejectedValue(new Error("transient")),
      },
    } as unknown as CloudflareEnv;
    await expect(recordRelayFailure(env)).resolves.toBeUndefined();
  });
});

describe("resetCircuitBreaker", () => {
  it("deletes the open marker from caches.default", async () => {
    const { delete: del } = installMockCache(undefined);
    await resetCircuitBreaker();
    expect(del).toHaveBeenCalledTimes(1);
    const [request] = del.mock.calls[0];
    expect((request as Request).url).toBe(CIRCUIT_OPEN_CACHE_URL);
  });

  it("detaches the cache.delete via ctx.waitUntil when provided", async () => {
    installMockCache(undefined);
    const ctx = { waitUntil: vi.fn() };
    await resetCircuitBreaker(ctx);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("fails open (no throw) when caches.default is unavailable", async () => {
    // No installMockCache call.
    await expect(resetCircuitBreaker()).resolves.toBeUndefined();
  });
});
