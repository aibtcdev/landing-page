import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildEdgeCacheKey,
  withEdgeCache,
  invalidateEdgeCache,
} from "../edge-cache";

// ---------------------------------------------------------------------------
// Mock for the global `caches.default` and `getCloudflareContext`
// ---------------------------------------------------------------------------

interface MockCacheStats {
  matches: number;
  puts: number;
  deletes: number;
}

interface MockCache {
  store: Map<string, Response>;
  stats: MockCacheStats;
}

function createMockCache(): MockCache {
  const store = new Map<string, Response>();
  const stats: MockCacheStats = { matches: 0, puts: 0, deletes: 0 };

  // The real Cache API uses Request objects as keys; we key by the
  // canonical URL string for simpler test introspection.
  const cache = {
    match: vi.fn(async (req: Request) => {
      stats.matches += 1;
      return store.get(req.url) ?? undefined;
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      stats.puts += 1;
      store.set(req.url, res);
    }),
    delete: vi.fn(async (req: Request) => {
      stats.deletes += 1;
      return store.delete(req.url);
    }),
  };

  // Install on the global `caches.default` shape.
  // Vitest doesn't ship a Workers `caches` global so we set it
  // directly on globalThis.
  (globalThis as unknown as {
    caches: { default: typeof cache };
  }).caches = { default: cache };

  return { store, stats };
}

// Mock @opennextjs/cloudflare so getCloudflareContext returns no ctx
// (forces synchronous cache.put — fine for test assertions).
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: {}, ctx: undefined }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildEdgeCacheKey", () => {
  it("lowercases the address for canonical matching", () => {
    expect(buildEdgeCacheKey("/api/agents", "bc1qABCDEF")).toBe(
      "https://cache.aibtc.local/api/agents/bc1qabcdef",
    );
  });

  it("appends the suffix verbatim", () => {
    expect(
      buildEdgeCacheKey(
        "/api/identity",
        "bc1qabc",
        "/reputation?type=summary",
      ),
    ).toBe(
      "https://cache.aibtc.local/api/identity/bc1qabc/reputation?type=summary",
    );
  });

  it("uses the synthetic cache.aibtc.local host", () => {
    expect(buildEdgeCacheKey("/api/agents", "x")).toMatch(
      /^https:\/\/cache\.aibtc\.local\/api\/agents\//,
    );
  });

  it("URL-encodes the address so reserved chars don't break new Request()", () => {
    // Spaces, slashes, hashes, etc. would otherwise produce an
    // invalid URL once `new Request(url)` parses it.
    const key = buildEdgeCacheKey("/api/agents", "weird name#1");
    expect(() => new Request(key)).not.toThrow();
    // The encoding survives lowercasing.
    expect(key).toContain("weird%20name%231");
  });
});

describe("withEdgeCache", () => {
  let cache: MockCache;

  beforeEach(() => {
    cache = createMockCache();
  });

  it("returns the cached response and skips the loader on hit", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const cachedBody = JSON.stringify({ cached: true });
    cache.store.set(key, new Response(cachedBody));

    const loader = vi.fn(async () => new Response("fresh"));
    const result = await withEdgeCache(key, 300, loader);

    expect(loader).not.toHaveBeenCalled();
    expect(await result.text()).toBe(cachedBody);
    expect(cache.stats.matches).toBe(1);
    expect(cache.stats.puts).toBe(0);
  });

  it("runs the loader and caches successful responses on miss", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = vi.fn(async () => new Response("fresh", { status: 200 }));

    const result = await withEdgeCache(key, 300, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(await result.text()).toBe("fresh");
    expect(cache.stats.puts).toBe(1);
    expect(cache.store.has(key)).toBe(true);
  });

  it("sets Cache-Control on the cached clone (not on the live response)", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = async () => new Response("fresh", { status: 200 });

    const result = await withEdgeCache(key, 600, loader);

    // Live response is untouched — caller controls client-facing
    // directives.
    expect(result.headers.get("Cache-Control")).toBeNull();

    // Cached entry carries the internal max-age so the Workers
    // cache layer expires it on schedule.
    const stored = cache.store.get(key);
    expect(stored?.headers.get("Cache-Control")).toBe(
      "public, max-age=600",
    );
  });

  it("does NOT cache non-ok responses", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );

    const result = await withEdgeCache(key, 300, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(404);
    expect(cache.stats.puts).toBe(0);
    expect(cache.store.has(key)).toBe(false);
  });

  it("does not pin transient 500s", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = vi.fn(
      async () => new Response("server error", { status: 500 }),
    );

    await withEdgeCache(key, 300, loader);
    await withEdgeCache(key, 300, loader);

    // Loader called both times — no caching of error response.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("preserves a Cache-Control already set by the loader on the live response", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = async () =>
      new Response("fresh", {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
        },
      });

    const result = await withEdgeCache(key, 600, loader);

    // Live response keeps the loader's directives — only the cached
    // clone gets our internal max-age.
    expect(result.headers.get("Cache-Control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
    );
  });

  it("falls through to the loader when caches.default is unavailable", async () => {
    // Simulate Node / `next dev` with no Workers caches global.
    const original = (globalThis as unknown as { caches?: unknown }).caches;
    (globalThis as unknown as { caches?: unknown }).caches = undefined;

    const loader = vi.fn(async () => new Response("fresh", { status: 200 }));
    const result = await withEdgeCache("https://x/y", 300, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(await result.text()).toBe("fresh");

    (globalThis as unknown as { caches?: unknown }).caches = original;
  });
});

describe("invalidateEdgeCache", () => {
  let cache: MockCache;

  beforeEach(() => {
    cache = createMockCache();
  });

  it("deletes a single entry", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    cache.store.set(key, new Response("body"));
    await invalidateEdgeCache(key);
    expect(cache.store.has(key)).toBe(false);
    expect(cache.stats.deletes).toBe(1);
  });

  it("deletes multiple entries in parallel", async () => {
    const k1 = "https://cache.aibtc.local/api/agents/bc1qa";
    const k2 = "https://cache.aibtc.local/api/identity/bc1qa";
    const k3 =
      "https://cache.aibtc.local/api/identity/bc1qa/reputation?type=summary";
    cache.store.set(k1, new Response());
    cache.store.set(k2, new Response());
    cache.store.set(k3, new Response());

    await invalidateEdgeCache(k1, k2, k3);

    expect(cache.store.has(k1)).toBe(false);
    expect(cache.store.has(k2)).toBe(false);
    expect(cache.store.has(k3)).toBe(false);
    expect(cache.stats.deletes).toBe(3);
  });

  it("is a no-op call (still issues delete) on a missing entry", async () => {
    await invalidateEdgeCache("https://cache.aibtc.local/api/agents/absent");
    expect(cache.stats.deletes).toBe(1);
  });

  it("swallows per-URL delete failures so one bad URL doesn't block the rest", async () => {
    const k1 = "https://cache.aibtc.local/api/agents/bc1qa";
    const k2 = "https://cache.aibtc.local/api/agents/bc1qb";
    cache.store.set(k1, new Response());
    cache.store.set(k2, new Response());

    // Make k1's delete throw; k2 should still succeed.
    const cacheImpl = (globalThis as unknown as {
      caches: { default: { delete: typeof cache["stats"] } };
    }).caches.default;
    const realDelete = cacheImpl.delete as unknown as typeof Cache.prototype.delete;
    (cacheImpl as unknown as { delete: typeof Cache.prototype.delete }).delete =
      vi.fn(async (req: Request) => {
        if (req.url === k1) throw new Error("simulated delete failure");
        return realDelete.call(cache as unknown as Cache, req);
      }) as unknown as typeof Cache.prototype.delete;

    await expect(invalidateEdgeCache(k1, k2)).resolves.toBeUndefined();
    // k2 still gone despite k1's failure.
    expect(cache.store.has(k2)).toBe(false);
  });

  it("is a no-op when caches.default is unavailable", async () => {
    const original = (globalThis as unknown as { caches?: unknown }).caches;
    (globalThis as unknown as { caches?: unknown }).caches = undefined;

    await expect(
      invalidateEdgeCache("https://cache.aibtc.local/api/agents/x"),
    ).resolves.toBeUndefined();

    (globalThis as unknown as { caches?: unknown }).caches = original;
  });
});
