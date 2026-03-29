import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkFixedWindowRateLimit } from "../rate-limit";

/**
 * In-memory KV mock that tracks put() calls for assertion.
 */
function createMockKV() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts?: object }> = [];

  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: object) => {
      store.set(key, value);
      puts.push({ key, value, opts });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: "" }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;

  return { kv, store, puts };
}

describe("checkFixedWindowRateLimit", () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request and starts a new window", async () => {
    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    expect(result.limited).toBe(false);
    expect(mockKV.puts).toHaveLength(1);

    // Should store "1:{now}" with full TTL
    const stored = mockKV.store.get("test-key")!;
    expect(stored).toMatch(/^1:\d+$/);
    expect(mockKV.puts[0].opts).toEqual({ expirationTtl: 60 });
  });

  it("increments counter on subsequent requests within window", async () => {
    const now = Date.now();
    mockKV.store.set("test-key", `3:${now}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    expect(result.limited).toBe(false);

    const stored = mockKV.store.get("test-key")!;
    const [count, windowStart] = stored.split(":");
    expect(count).toBe("4");
    expect(windowStart).toBe(String(now));
  });

  it("returns limited when count reaches max", async () => {
    const now = Date.now();
    mockKV.store.set("test-key", `10:${now}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    expect(result.limited).toBe(true);
  });

  it("does NOT write to KV when already at limit (idempotent 429)", async () => {
    const now = Date.now();
    mockKV.store.set("test-key", `10:${now}`);

    await checkFixedWindowRateLimit(mockKV.kv, "test-key", 10, 60);

    // No put() calls — the counter should not be incremented
    expect(mockKV.puts).toHaveLength(0);
  });

  it("resets window when KV key outlives its TTL (stuck key fix)", async () => {
    // Simulate a pre-#294 stuck key: count=10, window started 2 hours ago,
    // TTL is 60 seconds. The key should have expired but didn't.
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    mockKV.store.set("test-key", `10:${twoHoursAgo}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    // Should NOT be limited — the expired window is treated as fresh
    expect(result.limited).toBe(false);

    // Should have written count=1 with a new window start
    expect(mockKV.puts).toHaveLength(1);
    const stored = mockKV.store.get("test-key")!;
    const [count] = stored.split(":");
    expect(count).toBe("1");
    // Reset window should use a full TTL, not a residual value
    expect(mockKV.puts[0].opts).toEqual({ expirationTtl: 60 });
  });

  it("resets window for legacy count-only keys (no timestamp)", async () => {
    // Pre-#293 keys stored just a count with no :timestamp suffix.
    // These should be treated as expired rather than permanently stuck.
    mockKV.store.set("test-key", "10");

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    // Should NOT be limited — legacy key is treated as expired
    expect(result.limited).toBe(false);

    // Should have written count=1 with a fresh window
    expect(mockKV.puts).toHaveLength(1);
    const stored = mockKV.store.get("test-key")!;
    const [count] = stored.split(":");
    expect(count).toBe("1");
    expect(mockKV.puts[0].opts).toEqual({ expirationTtl: 60 });
  });

  it("resets window at exact TTL boundary", async () => {
    // Window started exactly ttlSeconds ago
    const exactlyExpired = Date.now() - 60 * 1000;
    mockKV.store.set("test-key", `10:${exactlyExpired}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    expect(result.limited).toBe(false);
  });

  it("still limits when window has NOT expired", async () => {
    // Window started 30 seconds ago, TTL is 60 seconds — still active
    const thirtySecsAgo = Date.now() - 30 * 1000;
    mockKV.store.set("test-key", `10:${thirtySecsAgo}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      60
    );

    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("returns correct resetAt timestamp", async () => {
    const now = Date.now();
    mockKV.store.set("test-key", `5:${now}`);

    const result = await checkFixedWindowRateLimit(
      mockKV.kv,
      "test-key",
      10,
      3600
    );

    const expectedResetAt = new Date(now + 3600 * 1000).toISOString();
    expect(result.resetAt).toBe(expectedResetAt);
  });

  it("preserves original window start on increment", async () => {
    const windowStart = Date.now() - 10 * 1000; // started 10s ago
    mockKV.store.set("test-key", `1:${windowStart}`);

    await checkFixedWindowRateLimit(mockKV.kv, "test-key", 10, 60);

    const stored = mockKV.store.get("test-key")!;
    const [, storedWindowStart] = stored.split(":");
    expect(storedWindowStart).toBe(String(windowStart));
  });

  it("sets correct remaining TTL on KV writes for existing windows", async () => {
    const windowStart = Date.now() - 20 * 1000; // started 20s ago
    mockKV.store.set("test-key", `1:${windowStart}`);

    await checkFixedWindowRateLimit(mockKV.kv, "test-key", 10, 60);

    // Remaining is 40s, but KV minimum TTL is 60 — clamped to 60
    expect(mockKV.puts[0].opts).toEqual({ expirationTtl: 60 });
  });
});
