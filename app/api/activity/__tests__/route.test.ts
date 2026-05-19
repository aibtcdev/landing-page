import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: { VERIFIED_AGENTS: {}, DB: undefined },
    ctx: undefined,
  }),
}));

// Default mock for buildActivityData — each test can override via mockResolvedValueOnce/mockRejectedValueOnce.
const buildActivityDataMock = vi.fn(async () => ({
  events: [],
  stats: { totalAgents: 0, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 },
}));

vi.mock("@/lib/activity", () => ({
  buildActivityData: (...args: unknown[]) => buildActivityDataMock(...args),
}));

interface MockCacheStats {
  matches: number;
  puts: number;
}

function installMockCache(): { store: Map<string, Response>; stats: MockCacheStats } {
  const store = new Map<string, Response>();
  const stats: MockCacheStats = { matches: 0, puts: 0 };
  const cache = {
    match: vi.fn(async (req: Request) => {
      stats.matches += 1;
      const stored = store.get(req.url);
      if (!stored) return undefined;
      // Return a fresh clone so the test code can consume the body without
      // exhausting the stored stream.
      return new Response(stored.clone().body, stored);
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      stats.puts += 1;
      store.set(req.url, res);
    }),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  };
  (globalThis as unknown as { caches: { default: typeof cache } }).caches = { default: cache };
  return { store, stats };
}

function uninstallMockCache() {
  (globalThis as unknown as { caches?: unknown }).caches = undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/activity", () => {
  beforeEach(() => {
    buildActivityDataMock.mockClear();
    buildActivityDataMock.mockImplementation(async () => ({
      events: [],
      stats: { totalAgents: 1, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 },
    }));
    vi.resetModules();
  });

  afterEach(() => {
    uninstallMockCache();
  });

  it("returns docs payload without calling buildActivityData or touching the cache", async () => {
    const { store, stats } = installMockCache();
    const { GET } = await import("../route");

    const res = await GET(
      new Request("https://aibtc.com/api/activity?docs=1") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(200);
    expect(buildActivityDataMock).not.toHaveBeenCalled();
    expect(stats.matches).toBe(0);
    expect(stats.puts).toBe(0);
    expect(store.size).toBe(0);
    const body = (await res.json()) as { endpoint: string };
    expect(body.endpoint).toBe("/api/activity");
  });

  it("on cache miss, runs buildActivityData once and populates caches.default", async () => {
    const { store, stats } = installMockCache();
    const { GET } = await import("../route");

    const res = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(buildActivityDataMock).toHaveBeenCalledTimes(1);
    expect(stats.puts).toBe(1);
    expect(store.has("https://cache.aibtc.local/api/activity")).toBe(true);
  });

  it("on cache hit, short-circuits the build and returns X-Cache: HIT", async () => {
    const { store, stats } = installMockCache();
    // Pre-populate the cache with a response carrying its own headers.
    store.set(
      "https://cache.aibtc.local/api/activity",
      new Response(JSON.stringify({ events: [], stats: { totalAgents: 42 } }), {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=120",
          "Content-Type": "application/json",
          "X-Cache": "MISS",
        },
      }),
    );

    const { GET } = await import("../route");
    const res = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(buildActivityDataMock).not.toHaveBeenCalled();
    expect(stats.matches).toBe(1);
    expect(stats.puts).toBe(0);
    const body = (await res.json()) as { stats: { totalAgents: number } };
    expect(body.stats.totalAgents).toBe(42);
  });

  it("dedupes concurrent cache-miss requests to a single buildActivityData call", async () => {
    installMockCache();

    // Hold buildActivityData open until all concurrent GETs have entered the in-flight dedup branch.
    let release!: (value: {
      events: never[];
      stats: { totalAgents: number; activeAgents: number; totalMessages: number; totalSatsTransacted: number };
    }) => void;
    const gate = new Promise<{
      events: never[];
      stats: { totalAgents: number; activeAgents: number; totalMessages: number; totalSatsTransacted: number };
    }>((resolve) => {
      release = resolve;
    });
    buildActivityDataMock.mockImplementationOnce(() => gate);

    const { GET } = await import("../route");

    const reqs = Array.from({ length: 5 }, () =>
      GET(new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0]),
    );

    // Yield enough microtasks for all five GETs to enter the inFlight dedup branch
    // (cache.match is async, getCloudflareContext is async, etc.). 20 is empirical:
    // ~3-4 awaits per GET before reaching inFlight under the current async stack.
    // If this test flaps after an upstream async-stack change, raise the count
    // rather than tightening it — over-draining is harmless, under-draining
    // releases the gate before all GETs reach dedup.
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
    release({ events: [], stats: { totalAgents: 7, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 } });

    const results = await Promise.all(reqs);

    expect(buildActivityDataMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.status).toBe(200);
      const body = (await r.json()) as { stats: { totalAgents: number } };
      expect(body.stats.totalAgents).toBe(7);
    }
  });

  it("clears the in-flight entry on build failure so the next request retries", async () => {
    installMockCache();

    buildActivityDataMock.mockRejectedValueOnce(new Error("boom"));

    const { GET } = await import("../route");

    const failed = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );
    expect(failed.status).toBe(500);

    // Second call must retry (in-flight entry was cleared in the finally block).
    buildActivityDataMock.mockResolvedValueOnce({
      events: [],
      stats: { totalAgents: 1, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 },
    });
    const ok = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );
    expect(ok.status).toBe(200);
    expect(buildActivityDataMock).toHaveBeenCalledTimes(2);
  });

  it("returns the built response even if cache.put rejects", async () => {
    // Steel-yeti S1: a failed cache.put must not fail an otherwise successful build.
    const store = new Map<string, Response>();
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {
        throw new Error("simulated cache.put failure");
      }),
      delete: vi.fn(async () => true),
    };
    (globalThis as unknown as { caches: { default: typeof cache } }).caches = {
      default: cache,
    };

    const { GET } = await import("../route");
    const res = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  it("falls through to building (no cache reads/writes) when caches.default is unavailable", async () => {
    uninstallMockCache();
    const { GET } = await import("../route");

    const res = await GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );

    expect(res.status).toBe(200);
    expect(buildActivityDataMock).toHaveBeenCalledTimes(1);
  });
});
