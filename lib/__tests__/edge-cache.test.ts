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

  it("sets Cache-Control on the live response", async () => {
    const key = "https://cache.aibtc.local/api/agents/bc1qa";
    const loader = async () => new Response("fresh", { status: 200 });

    const result = await withEdgeCache(key, 600, loader);
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=600");
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
});
