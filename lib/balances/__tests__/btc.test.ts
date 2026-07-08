/**
 * Balance caches — the cost fix that collapses repeat profile views into one
 * upstream call per leg (L1 mempool.space + L2 Hiro). Locks, for each leg:
 *   1. cache hit returns without calling upstream
 *   2. a real answer (incl. genuine 0) is written to KV with a TTL
 *   3. a transient upstream failure is NOT cached (next view retries)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBtcBalance } from "../btc";

const STX = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const BTC = "bc1qexampleexampleexampleexampleexampleex";
const L1_KEY = `cache:btc-balance:${BTC}`;
const L2_KEY = `cache:sbtc-balance:${STX}`;

function mockKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> };
}

/** mempool.space (L1) response: funded − spent = balance sats. */
function l1Ok(sats: number) {
  return {
    ok: true,
    json: async () => ({ chain_stats: { funded_txo_sum: sats, spent_txo_sum: 0 } }),
  };
}
/** Hiro (L2) /balances response with the given sBTC balance string. */
function l2Ok(sbtcBalance: string) {
  return {
    ok: true,
    json: async () => ({
      fungible_tokens: {
        // Must match SBTC_ASSET_ID built in btc.ts from SBTC_CONTRACTS.mainnet.
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token": {
          balance: sbtcBalance,
        },
      },
    }),
  };
}
const FAIL = { ok: false, json: async () => ({}) };

/**
 * Stub global fetch, routing each leg to a provided response. Defaults to a
 * failing response so a test that only cares about one leg doesn't
 * accidentally cache the other.
 */
function stubFetch(opts: { l1?: unknown; l2?: unknown }) {
  const spy = vi.fn(async (url: string) => {
    if (url.includes("mempool.space")) return opts.l1 ?? FAIL;
    return opts.l2 ?? FAIL; // Hiro /balances
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBtcBalance — L2 (sBTC / Hiro) cache", () => {
  it("serves the L2 balance from KV without calling Hiro on a cache hit", async () => {
    const kv = mockKv({ [L2_KEY]: "123456" });
    const fetchSpy = stubFetch({ l1: l1Ok(0), l2: l2Ok("999") });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(123456);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/balances"),
      expect.anything(),
    );
  });

  it("writes a fresh L2 answer (incl. genuine 0) to KV with a TTL", async () => {
    const kv = mockKv();
    stubFetch({ l1: FAIL, l2: l2Ok("0") });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(0);
    expect(kv.put).toHaveBeenCalledWith(L2_KEY, "0", { expirationTtl: 1800 });
  });

  it("does NOT cache a transient Hiro failure", async () => {
    const kv = mockKv();
    stubFetch({ l1: FAIL, l2: FAIL });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(0);
    expect(kv.put).not.toHaveBeenCalledWith(L2_KEY, expect.anything(), expect.anything());
  });
});

describe("fetchBtcBalance — L1 (native BTC / mempool.space) cache", () => {
  it("serves the L1 balance from KV without calling mempool.space on a cache hit", async () => {
    const kv = mockKv({ [L1_KEY]: "55555" });
    const fetchSpy = stubFetch({ l1: l1Ok(999), l2: FAIL });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l1Sats).toBe(55555);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("mempool.space"),
      expect.anything(),
    );
  });

  it("writes a fresh L1 answer to KV with a TTL", async () => {
    const kv = mockKv();
    stubFetch({ l1: l1Ok(88), l2: FAIL });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l1Sats).toBe(88);
    expect(kv.put).toHaveBeenCalledWith(L1_KEY, "88", { expirationTtl: 1800 });
  });

  it("does NOT cache a transient mempool.space failure", async () => {
    const kv = mockKv();
    stubFetch({ l1: FAIL, l2: FAIL });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l1Sats).toBe(0);
    expect(kv.put).not.toHaveBeenCalledWith(L1_KEY, expect.anything(), expect.anything());
  });
});

describe("fetchBtcBalance — no KV binding", () => {
  it("falls straight through to both upstreams", async () => {
    stubFetch({ l1: l1Ok(777), l2: l2Ok("888") });

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key");
    expect(bal.l1Sats).toBe(777);
    expect(bal.l2Sats).toBe(888);
  });
});
