import { describe, it, expect, vi } from "vitest";
import {
  getCachedTokenPrice,
  setCachedTokenPrice,
  TENERO_PRICE_KV_PREFIX,
  TENERO_PRICE_KV_TTL_SECONDS,
} from "../kv-cache";

/**
 * Hand-rolled KV double — just enough surface for `get("...", "json")` and
 * `put("...", string, options)` to round-trip. Mirrors the inline-double
 * pattern used in `lib/__tests__/edge-cache.test.ts` rather than miniflare.
 */
function createFakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{
    key: string;
    value: string;
    options?: KVNamespacePutOptions;
  }> = [];

  const kv = {
    get: vi.fn(async (key: string, type?: "json") => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    }),
    put: vi.fn(
      async (key: string, value: string, options?: KVNamespacePutOptions) => {
        store.set(key, value);
        puts.push({ key, value, options });
      }
    ),
  };

  return { kv, store, puts };
}

describe("getCachedTokenPrice", () => {
  it("returns null for a tokenId that hasn't been cached", async () => {
    const { kv } = createFakeKv();
    const result = await getCachedTokenPrice(
      kv as unknown as KVNamespace,
      "stx"
    );
    expect(result).toBeNull();
  });

  it("round-trips a written entry through setCachedTokenPrice", async () => {
    const { kv, puts } = createFakeKv();
    const tokenId = "stx";
    const now = 1_715_000_000_000;

    await setCachedTokenPrice(kv as unknown as KVNamespace, tokenId, {
      priceUsd: 1.85,
      fetchedAt: now,
      minuteRemaining: 47,
      monthRemaining: 12_345,
    });

    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(`${TENERO_PRICE_KV_PREFIX}${tokenId}`);
    expect(puts[0].options?.expirationTtl).toBe(TENERO_PRICE_KV_TTL_SECONDS);

    const read = await getCachedTokenPrice(
      kv as unknown as KVNamespace,
      tokenId
    );
    expect(read).toEqual({
      priceUsd: 1.85,
      fetchedAt: now,
      minuteRemaining: 47,
      monthRemaining: 12_345,
    });
  });

  it("returns null when the cached value is shape-incompatible", async () => {
    const { kv, store } = createFakeKv();
    // Simulate a stale or hand-edited entry: missing `fetchedAt` is the
    // only required field, so the reader treats it as a miss rather than
    // throwing or returning garbage to consumers.
    store.set(`${TENERO_PRICE_KV_PREFIX}stx`, JSON.stringify({ priceUsd: 1.85 }));
    const result = await getCachedTokenPrice(
      kv as unknown as KVNamespace,
      "stx"
    );
    expect(result).toBeNull();
  });

  it("treats a non-finite priceUsd as null without throwing", async () => {
    const { kv, store } = createFakeKv();
    store.set(
      `${TENERO_PRICE_KV_PREFIX}stx`,
      JSON.stringify({ priceUsd: "not a number", fetchedAt: 123 })
    );
    const result = await getCachedTokenPrice(
      kv as unknown as KVNamespace,
      "stx"
    );
    expect(result).toEqual({
      priceUsd: null,
      fetchedAt: 123,
      minuteRemaining: null,
      monthRemaining: null,
    });
  });
});
