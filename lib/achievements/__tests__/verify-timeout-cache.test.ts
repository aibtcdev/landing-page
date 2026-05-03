import { describe, it, expect, beforeEach, vi } from "vitest";
import { verifySenderAchievement } from "../verify";

/**
 * In-memory KVNamespace stand-in. Models the put/get/delete subset used by
 * lib/identity/kv-cache.ts plus expirationTtl semantics for the timeout
 * sentinel.
 */
class FakeKV {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private now = () => Date.now();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number }
  ): Promise<void> {
    const ttl = opts?.expirationTtl ?? 0;
    this.store.set(key, {
      value,
      expiresAt: ttl > 0 ? this.now() + ttl * 1000 : 0,
    });
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  size() {
    return this.store.size;
  }
  has(key: string) {
    return this.store.has(key);
  }
}

const ADDR = "bc1q-verify-timeout-test";

describe("verifySenderAchievement — timeout sentinel cache", () => {
  let kv: FakeKV;

  beforeEach(() => {
    kv = new FakeKV();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("first call times out, second call within 60s short-circuits without re-fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const e = new Error("aborted") as Error & { name: string };
      e.name = "TimeoutError";
      return Promise.reject(e);
    });

    const first = await verifySenderAchievement(ADDR, kv as unknown as KVNamespace);
    expect(first).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Sentinel cached.
    expect(kv.has(`cache:verify-timeout:sender:${ADDR}`)).toBe(true);

    const second = await verifySenderAchievement(ADDR, kv as unknown as KVNamespace);
    expect(second).toBe(false);
    // Crucial: no additional fetch — the sentinel short-circuited the verify.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("after the 60s sentinel TTL elapses, the next call retries the upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const e = new Error("aborted") as Error & { name: string };
      e.name = "TimeoutError";
      return Promise.reject(e);
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T15:00:00Z"));

    await verifySenderAchievement(ADDR, kv as unknown as KVNamespace);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past the sentinel TTL.
    vi.setSystemTime(new Date("2026-05-03T15:01:01Z"));

    await verifySenderAchievement(ADDR, kv as unknown as KVNamespace);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("non-timeout errors do not write the timeout sentinel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      // 503 — the function returns false in this branch but doesn't throw,
      // so simulate via a throwing JSON parse error to hit the catch block
      // with a non-timeout error.
      return Promise.resolve(
        new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })
      );
    });

    await verifySenderAchievement(ADDR, kv as unknown as KVNamespace);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // No timeout sentinel — the JSON parse failure is a logic error, not
    // a transient upstream timeout.
    expect(kv.has(`cache:verify-timeout:sender:${ADDR}`)).toBe(false);
  });
});
