import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupBtcAddressByBnsName,
  syncBnsLookup,
  deleteBnsLookup,
} from "../bns-reverse-index";

// ---------------------------------------------------------------------------
// Mock KVNamespace (single-threaded, synchronous-effective)
// ---------------------------------------------------------------------------

interface MockKVStats {
  reads: number;
  writes: number;
  deletes: number;
}

interface MockKV {
  store: Map<string, string>;
  stats: MockKVStats;
  asKv(): KVNamespace;
}

function createMockKv(): MockKV {
  const store = new Map<string, string>();
  const stats: MockKVStats = { reads: 0, writes: 0, deletes: 0 };

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
  };

  return {
    store,
    stats,
    asKv: () => impl as unknown as KVNamespace,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lookupBtcAddressByBnsName", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("returns the stored btcAddress for a written name", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    const result = await lookupBtcAddressByBnsName(kv.asKv(), "alice.btc");
    expect(result).toBe("bc1qalice");
  });

  it("normalises the name to lowercase before lookup", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    const result = await lookupBtcAddressByBnsName(kv.asKv(), "AlIcE.bTc");
    expect(result).toBe("bc1qalice");
  });

  it("returns null when no entry exists", async () => {
    const result = await lookupBtcAddressByBnsName(kv.asKv(), "absent.btc");
    expect(result).toBeNull();
  });

  it("does exactly one KV read", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await lookupBtcAddressByBnsName(kv.asKv(), "alice.btc");
    expect(kv.stats.reads).toBe(1);
  });
});

describe("syncBnsLookup", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("writes a new entry on register (oldBnsName=null)", async () => {
    await syncBnsLookup(kv.asKv(), null, "alice.btc", "bc1qalice");
    expect(kv.store.get("bns-lookup:alice.btc")).toBe("bc1qalice");
    expect(kv.stats.writes).toBe(1);
    expect(kv.stats.deletes).toBe(0);
  });

  it("writes nothing when both old and new are null", async () => {
    await syncBnsLookup(kv.asKv(), null, null, "bc1qalice");
    expect(kv.stats.writes).toBe(0);
    expect(kv.stats.deletes).toBe(0);
  });

  it("deletes the old entry on agent delete (newBnsName=null)", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await syncBnsLookup(kv.asKv(), "alice.btc", null, "bc1qalice");
    expect(kv.store.has("bns-lookup:alice.btc")).toBe(false);
    expect(kv.stats.deletes).toBe(1);
    expect(kv.stats.writes).toBe(0);
  });

  it("on rename, deletes old entry and writes new one in parallel", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await syncBnsLookup(kv.asKv(), "alice.btc", "alice2.btc", "bc1qalice");
    expect(kv.store.has("bns-lookup:alice.btc")).toBe(false);
    expect(kv.store.get("bns-lookup:alice2.btc")).toBe("bc1qalice");
    expect(kv.stats.deletes).toBe(1);
    expect(kv.stats.writes).toBe(1);
  });

  it("is a no-op when old and new are the same (case-insensitive)", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await syncBnsLookup(kv.asKv(), "alice.btc", "ALICE.BTC", "bc1qalice");
    expect(kv.stats.writes).toBe(0);
    expect(kv.stats.deletes).toBe(0);
    expect(kv.store.get("bns-lookup:alice.btc")).toBe("bc1qalice");
  });

  it("normalises names to lowercase on write", async () => {
    await syncBnsLookup(kv.asKv(), null, "ALICE.BTC", "bc1qalice");
    expect(kv.store.get("bns-lookup:alice.btc")).toBe("bc1qalice");
    expect(kv.store.has("bns-lookup:ALICE.BTC")).toBe(false);
  });

  it("handles undefined as equivalent to null for both old and new", async () => {
    await syncBnsLookup(kv.asKv(), undefined, undefined, "bc1qalice");
    expect(kv.stats.writes).toBe(0);
  });
});

describe("deleteBnsLookup", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = createMockKv();
  });

  it("deletes the entry for a name", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await deleteBnsLookup(kv.asKv(), "alice.btc");
    expect(kv.store.has("bns-lookup:alice.btc")).toBe(false);
  });

  it("is idempotent on a missing entry", async () => {
    await deleteBnsLookup(kv.asKv(), "absent.btc");
    expect(kv.stats.deletes).toBe(1);
  });

  it("normalises the name before deletion", async () => {
    kv.store.set("bns-lookup:alice.btc", "bc1qalice");
    await deleteBnsLookup(kv.asKv(), "ALICE.BTC");
    expect(kv.store.has("bns-lookup:alice.btc")).toBe(false);
  });
});

describe("end-to-end lifecycle", () => {
  it("supports register -> lookup -> rename -> lookup -> delete", async () => {
    const kv = createMockKv();

    // Register
    await syncBnsLookup(kv.asKv(), null, "alice.btc", "bc1qalice");
    let result = await lookupBtcAddressByBnsName(kv.asKv(), "alice.btc");
    expect(result).toBe("bc1qalice");

    // Rename
    await syncBnsLookup(kv.asKv(), "alice.btc", "alice2.btc", "bc1qalice");
    result = await lookupBtcAddressByBnsName(kv.asKv(), "alice.btc");
    expect(result).toBeNull();
    result = await lookupBtcAddressByBnsName(kv.asKv(), "alice2.btc");
    expect(result).toBe("bc1qalice");

    // Delete agent
    await syncBnsLookup(kv.asKv(), "alice2.btc", null, "bc1qalice");
    result = await lookupBtcAddressByBnsName(kv.asKv(), "alice2.btc");
    expect(result).toBeNull();
  });
});
