import { describe, it, expect, beforeEach } from "vitest";
import {
  getAgentsIndex,
  invalidateAgentsIndex,
  type AgentsIndex,
} from "../agents-index";
import type { AgentRecord } from "../types";

// ---------------------------------------------------------------------------
// Mock KVNamespace
// ---------------------------------------------------------------------------

interface MockKVStats {
  reads: number;
  writes: number;
  deletes: number;
  lists: number;
}

interface MockKV {
  store: Map<string, string>;
  stats: MockKVStats;
  /** Cast helper: returns the same object typed as KVNamespace. */
  asKv(): KVNamespace;
}

function createMockKv(): MockKV {
  const store = new Map<string, string>();
  const stats: MockKVStats = { reads: 0, writes: 0, deletes: 0, lists: 0 };

  const impl = {
    get: async (key: string) => {
      stats.reads += 1;
      return store.has(key) ? store.get(key)! : null;
    },
    put: async (key: string, value: string) => {
      stats.writes += 1;
      store.set(key, String(value));
    },
    delete: async (key: string) => {
      stats.deletes += 1;
      store.delete(key);
    },
    list: async (opts?: { prefix?: string; cursor?: string }) => {
      stats.lists += 1;
      const prefix = opts?.prefix ?? "";
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  };

  return {
    store,
    stats,
    asKv: () => impl as unknown as KVNamespace,
  };
}

function makeAgent(seed: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    btcAddress: `bc1q${seed}`,
    stxAddress: `SP${seed.toUpperCase()}`,
    stxPublicKey: "stxpubkey",
    btcPublicKey: "btcpubkey",
    taprootAddress: null,
    displayName: `Agent ${seed}`,
    description: null,
    bnsName: `${seed}.btc`,
    verifiedAt: "2026-05-05T00:00:00Z",
    ...overrides,
  };
}

function seedAgents(kv: MockKV, agents: AgentRecord[]): void {
  for (const a of agents) {
    kv.store.set(`stx:${a.stxAddress}`, JSON.stringify(a));
    kv.store.set(`btc:${a.btcAddress}`, JSON.stringify(a));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAgentsIndex", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("cold-miss build scans stx:* and writes a valid index", async () => {
    seedAgents(kv, [makeAgent("a"), makeAgent("b"), makeAgent("c")]);

    const index = await getAgentsIndex(kv.asKv());

    expect(index.v).toBe(1);
    expect(index.agents).toHaveLength(3);
    expect(index.agents.map((e) => e.btcAddress).sort()).toEqual([
      "bc1qa",
      "bc1qb",
      "bc1qc",
    ]);
    expect(kv.store.has("agents:index")).toBe(true);
    // Sentinel cleared
    expect(kv.store.has("agents:index:building")).toBe(false);
  });

  it("returns the cached index on subsequent reads (no re-scan)", async () => {
    seedAgents(kv, [makeAgent("a")]);

    await getAgentsIndex(kv.asKv());
    const listsAfterFirst = kv.stats.lists;
    const readsAfterFirst = kv.stats.reads;

    await getAgentsIndex(kv.asKv());

    // Subsequent calls only do a single read for the index key.
    expect(kv.stats.lists).toBe(listsAfterFirst);
    expect(kv.stats.reads).toBe(readsAfterFirst + 1);
  });

  it("includes the slim index fields and excludes non-indexed fields", async () => {
    seedAgents(kv, [
      makeAgent("a", {
        taprootAddress: "bc1pa",
        capabilities: ["btc", "defi"],
        // Non-indexed fields below should NOT appear in the entry.
        owner: "@somebody",
        erc8004AgentId: 42,
      }),
    ]);

    const index = await getAgentsIndex(kv.asKv());
    const entry = index.agents[0];

    expect(entry.btcAddress).toBe("bc1qa");
    expect(entry.stxAddress).toBe("SPA");
    expect(entry.taprootAddress).toBe("bc1pa");
    expect(entry.bnsName).toBe("a.btc");
    expect(entry.displayName).toBe("Agent a");
    expect(entry.capabilities).toEqual(["btc", "defi"]);
    expect(entry.verifiedAt).toBe("2026-05-05T00:00:00Z");

    // Non-indexed fields must not leak into the entry.
    const loose = entry as unknown as Record<string, unknown>;
    expect(loose.owner).toBeUndefined();
    expect(loose.erc8004AgentId).toBeUndefined();
    expect(loose.description).toBeUndefined();
  });

  it("treats malformed cached JSON as a cold miss and rebuilds", async () => {
    seedAgents(kv, [makeAgent("a")]);
    kv.store.set("agents:index", "{ not valid json");

    const index = await getAgentsIndex(kv.asKv());

    expect(index.agents).toHaveLength(1);
    expect(index.agents[0].btcAddress).toBe("bc1qa");
  });

  it("rebuilds when the cached schema version is wrong", async () => {
    seedAgents(kv, [makeAgent("a")]);
    kv.store.set(
      "agents:index",
      JSON.stringify({ v: 99, agents: [], updatedAt: "x" }),
    );

    const index = await getAgentsIndex(kv.asKv());
    expect(index.v).toBe(1);
    expect(index.agents).toHaveLength(1);
  });

  it("skips records that fail to JSON-parse without aborting the rebuild", async () => {
    seedAgents(kv, [makeAgent("a")]);
    kv.store.set("stx:CORRUPT", "{ not valid");

    const index = await getAgentsIndex(kv.asKv());

    expect(index.agents).toHaveLength(1);
    expect(index.agents[0].btcAddress).toBe("bc1qa");
  });

  it("returns an empty index when no agents exist", async () => {
    const index = await getAgentsIndex(kv.asKv());
    expect(index.v).toBe(1);
    expect(index.agents).toEqual([]);
  });
});

describe("invalidateAgentsIndex", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("deletes the agents:index key", async () => {
    seedAgents(kv, [makeAgent("a")]);
    await getAgentsIndex(kv.asKv());
    expect(kv.store.has("agents:index")).toBe(true);

    await invalidateAgentsIndex(kv.asKv());
    expect(kv.store.has("agents:index")).toBe(false);
  });

  it("is idempotent — second invalidate is a no-op on already-missing index", async () => {
    await invalidateAgentsIndex(kv.asKv());
    await invalidateAgentsIndex(kv.asKv());
    expect(kv.store.has("agents:index")).toBe(false);
  });

  it("triggers a fresh rebuild on the next read after invalidation", async () => {
    seedAgents(kv, [makeAgent("a")]);
    await getAgentsIndex(kv.asKv());

    // Add a new agent via source state (simulating a register).
    seedAgents(kv, [makeAgent("b")]);
    // Without invalidation, cached index is stale — confirm.
    let index = await getAgentsIndex(kv.asKv());
    expect(index.agents.map((e) => e.btcAddress).sort()).toEqual(["bc1qa"]);

    // After invalidation the rebuild picks up the new agent.
    await invalidateAgentsIndex(kv.asKv());
    index = await getAgentsIndex(kv.asKv());
    expect(index.agents.map((e) => e.btcAddress).sort()).toEqual([
      "bc1qa",
      "bc1qb",
    ]);
  });
});

// ---------------------------------------------------------------------------
// D1 path
// ---------------------------------------------------------------------------

interface MockD1Row {
  btc_address: string;
  stx_address: string;
  taproot_address: string | null;
  bns_name: string | null;
  display_name: string | null;
  capabilities_json: string | null;
  verified_at: string;
}

function makeD1Row(seed: string, overrides: Partial<MockD1Row> = {}): MockD1Row {
  return {
    btc_address: `bc1q${seed}`,
    stx_address: `SP${seed.toUpperCase()}`,
    taproot_address: null,
    bns_name: `${seed}.btc`,
    display_name: `Agent ${seed}`,
    capabilities_json: null,
    verified_at: "2026-05-05T00:00:00Z",
    ...overrides,
  };
}

function makeD1(rows: MockD1Row[]): D1Database {
  return {
    prepare: () => ({
      all: async () => ({ results: rows }),
    }),
  } as unknown as D1Database;
}

function make100D1Rows(): MockD1Row[] {
  return Array.from({ length: 100 }, (_, i) => makeD1Row(`row${i}`));
}

describe("getAgentsIndex — D1 path", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("builds index from D1 when SELECT returns >= 100 rows", async () => {
    const rows = make100D1Rows();
    const db = makeD1(rows);

    const index = await getAgentsIndex(kv.asKv(), db);

    expect(index.v).toBe(1);
    expect(index.agents).toHaveLength(100);
    expect(index.agents[0].btcAddress).toBe("bc1qrow0");
    // Index was cached in KV
    expect(kv.store.has("agents:index")).toBe(true);
    // KV scan list should NOT have been called (D1 path used)
    expect(kv.stats.lists).toBe(0);
  });

  it("accepts any result from D1 regardless of row count (MIN_EXPECTED_D1_ROWS guard retired per #783/#691)", async () => {
    // Seed 3 agents in KV — these should NOT be used since D1 returns a result.
    seedAgents(kv, [makeAgent("a"), makeAgent("b"), makeAgent("c")]);

    // D1 returns only 2 rows (below the old 100-row threshold).
    const db = makeD1([makeD1Row("only1"), makeD1Row("only2")]);

    const index = await getAgentsIndex(kv.asKv(), db);

    // Should use D1 result (2 agents), NOT fall back to KV scan (3 agents).
    // The MIN_EXPECTED_D1_ROWS guard was retired in P3 — D1 backfill (#691) is done.
    expect(index.agents).toHaveLength(2);
    // KV scan list should NOT have been called (D1 path used).
    expect(kv.stats.lists).toBe(0);
  });

  it("falls back to KV scan when D1 throws", async () => {
    seedAgents(kv, [makeAgent("x")]);

    const db = {
      prepare: () => ({
        all: async () => {
          throw new Error("D1 unavailable");
        },
      }),
    } as unknown as D1Database;

    const index = await getAgentsIndex(kv.asKv(), db);

    expect(index.agents).toHaveLength(1);
    expect(index.agents[0].btcAddress).toBe("bc1qx");
    expect(kv.stats.lists).toBeGreaterThan(0);
  });

  it("sets capabilities to null when capabilities_json is malformed", async () => {
    const rows = [
      ...make100D1Rows().slice(0, 99),
      makeD1Row("bad", { capabilities_json: "{ not valid json" }),
    ];
    const db = makeD1(rows);

    const index = await getAgentsIndex(kv.asKv(), db);

    const badEntry = index.agents.find((e) => e.btcAddress === "bc1qbad");
    expect(badEntry).toBeDefined();
    expect(badEntry!.capabilities).toBeNull();
  });

  it("uses KV scan path when db is undefined (no D1 binding)", async () => {
    seedAgents(kv, [makeAgent("a")]);

    const index = await getAgentsIndex(kv.asKv(), undefined);

    expect(index.agents).toHaveLength(1);
    expect(kv.stats.lists).toBeGreaterThan(0);
  });
});

describe("AgentsIndex schema (round-trip)", () => {
  it("stable JSON round-trip preserves the schema", async () => {
    const kv = createMockKv();
    seedAgents(kv, [makeAgent("a"), makeAgent("b")]);

    const built = await getAgentsIndex(kv.asKv());
    const raw = kv.store.get("agents:index")!;
    const parsed: AgentsIndex = JSON.parse(raw);

    expect(parsed.v).toBe(built.v);
    expect(parsed.agents).toEqual(built.agents);
    expect(typeof parsed.updatedAt).toBe("string");
  });
});
