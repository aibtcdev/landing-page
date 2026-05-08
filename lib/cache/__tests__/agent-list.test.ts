import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidateAgentListCache } from "../agent-list";

// ---------------------------------------------------------------------------
// Minimal KV mock
// ---------------------------------------------------------------------------

const CACHE_KEY = "cache:agent-list";
const FRESH_WINDOW_SECONDS = 120;
const CACHE_TTL_SECONDS = 600;

interface MockKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function makeFreshSnapshot(overrides?: { cachedAt?: string }) {
  return JSON.stringify({
    agents: [],
    stats: { total: 0, genesisCount: 0, messageCount: 0 },
    cachedAt: overrides?.cachedAt ?? new Date().toISOString(),
  });
}

function mockKV(store: Record<string, string | null> = {}): MockKV {
  const data = new Map<string, string | null>(Object.entries(store));
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("invalidateAgentListCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  it("rewrites snapshot with cachedAt past FRESH_WINDOW_SECONDS; never calls kv.delete", async () => {
    const kv = mockKV({ [CACHE_KEY]: makeFreshSnapshot() });

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    expect(kv.delete).not.toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalledWith(
      CACHE_KEY,
      expect.stringContaining('"cachedAt"'),
      expect.objectContaining({ expirationTtl: CACHE_TTL_SECONDS })
    );

    const written = JSON.parse(kv.put.mock.calls[0][1] as string);
    const writtenAgeSeconds =
      (Date.now() - new Date(written.cachedAt as string).getTime()) / 1000;
    expect(writtenAgeSeconds).toBeGreaterThan(FRESH_WINDOW_SECONDS);
    expect(writtenAgeSeconds).toBeLessThan(CACHE_TTL_SECONDS);
  });

  it("is a no-op when no snapshot exists in KV", async () => {
    const kv = mockKV({});

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("deletes a corrupt entry and does not call kv.put", async () => {
    const kv = mockKV({ [CACHE_KEY]: "not-valid-json{{" });

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    expect(kv.delete).toHaveBeenCalledWith(CACHE_KEY);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("skips mark-stale when a newer snapshot lands between the two reads", async () => {
    const oldCachedAt = "2026-01-01T11:59:00Z";
    const newCachedAt = "2026-01-01T12:00:00Z"; // strictly newer

    let callCount = 0;
    const kv: MockKV = {
      get: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First read: stale snapshot
          return makeFreshSnapshot({ cachedAt: oldCachedAt });
        }
        // Second read (optimistic re-check): fresh rebuild landed
        return makeFreshSnapshot({ cachedAt: newCachedAt });
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("proceeds with mark-stale when the second read shows the same snapshot", async () => {
    const snapshot = makeFreshSnapshot({ cachedAt: "2026-01-01T11:58:00Z" });
    const kv = mockKV({ [CACHE_KEY]: snapshot });

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it("preserves agents and stats while only shifting cachedAt", async () => {
    const original = {
      agents: [{ stxAddress: "SP1" }],
      stats: { total: 1, genesisCount: 0, messageCount: 3 },
      cachedAt: "2026-01-01T11:58:00Z",
    };
    const kv = mockKV({ [CACHE_KEY]: JSON.stringify(original) });

    await invalidateAgentListCache(kv as unknown as KVNamespace);

    const written = JSON.parse(kv.put.mock.calls[0][1] as string);
    expect(written.agents).toEqual(original.agents);
    expect(written.stats).toEqual(original.stats);
    expect(written.cachedAt).not.toBe(original.cachedAt);
  });
});
