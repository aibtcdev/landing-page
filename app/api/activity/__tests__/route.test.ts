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

  it("returns docs payload without calling buildActivityData or touching the cache, and does not leak the internal cache URL", async () => {
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
    const bodyText = await res.text();
    const body = JSON.parse(bodyText) as { endpoint: string };
    expect(body.endpoint).toBe("/api/activity");
    // Public docs payload must not expose the worker-internal pseudo-host
    // used for caches.default keys (steel-yeti S3).
    expect(bodyText).not.toContain("cache.aibtc.local");
    expect(bodyText).not.toContain("cacheKeyUrl");
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
    // Deterministic barrier: install a cache.match shim that counts callers and
    // resolves them only after all N have arrived. By the time cache.match
    // unblocks each caller, the leader has set the inFlight slot and the
    // others see it via inFlight.get on their next step — no microtask-drain
    // guesswork (steel-yeti cycle-2 nit).
    const TOTAL = 5;
    const store = new Map<string, Response>();
    let arrived = 0;
    let release!: () => void;
    const allArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cache = {
      match: vi.fn(async (req: Request) => {
        arrived += 1;
        if (arrived === TOTAL) release();
        await allArrived;
        return store.get(req.url);
      }),
      put: vi.fn(async (req: Request, res: Response) => {
        store.set(req.url, res);
      }),
      delete: vi.fn(async (req: Request) => store.delete(req.url)),
    };
    (globalThis as unknown as { caches: { default: typeof cache } }).caches = {
      default: cache,
    };

    buildActivityDataMock.mockResolvedValue({
      events: [],
      stats: { totalAgents: 7, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 },
    });

    const { GET } = await import("../route");

    const results = await Promise.all(
      Array.from({ length: TOTAL }, () =>
        GET(new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0]),
      ),
    );

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

  it("holds the in-flight slot until cache.put settles (Codex race)", async () => {
    // Codex P2: with ctx.waitUntil, buildAndCache returned before cache.put
    // resolved. If inFlight was cleared on response-ready instead of put-settled,
    // a second request arriving in that window would see both a cache miss
    // and an empty inFlight and trigger a duplicate rebuild.
    const store = new Map<string, Response>();
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const cache = {
      match: vi.fn(async (req: Request) => {
        const stored = store.get(req.url);
        if (!stored) return undefined;
        return new Response(stored.clone().body, stored);
      }),
      put: vi.fn(async (req: Request, res: Response) => {
        await putGate; // hold the put open
        store.set(req.url, res);
      }),
      delete: vi.fn(async () => true),
    };
    (globalThis as unknown as { caches: { default: typeof cache } }).caches = {
      default: cache,
    };

    // Signal fired the moment the leader's cache.put begins — at that point
    // buildActivityData has returned and the put is awaiting `putGate`.
    let signalPutStarted!: () => void;
    const putStarted = new Promise<void>((resolve) => {
      signalPutStarted = resolve;
    });
    cache.put = vi.fn(async (req: Request, res: Response) => {
      signalPutStarted();
      await putGate;
      store.set(req.url, res);
    });

    const { GET } = await import("../route");

    const first = GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );

    // Deterministic: wait until the leader has actually entered cache.put.
    // At this point the response is built and the inFlight slot is at risk
    // of being cleared if the implementation released it on response-ready.
    await putStarted;

    // Second request enters the response-ready → put-settled window. With
    // the fix it sees the populated inFlight slot and does NOT trigger
    // a second buildActivityData call.
    const second = GET(
      new Request("https://aibtc.com/api/activity") as unknown as Parameters<typeof GET>[0],
    );
    // Let second progress through cache.match + inFlight lookup before
    // we release the put. A small microtask drain here is sufficient
    // and bounded — we only need second past inFlight.get, which is two
    // awaits deep from GET entry.
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }

    releasePut();
    await Promise.all([first, second]);

    expect(buildActivityDataMock).toHaveBeenCalledTimes(1);
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
