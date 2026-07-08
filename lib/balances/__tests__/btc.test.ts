/**
 * L2 (sBTC) balance cache — the cost fix that collapses repeat profile views
 * into one metered Hiro call. Locks three behaviors:
 *   1. cache hit returns without calling Hiro
 *   2. a real answer (incl. genuine 0) is written to KV with a TTL
 *   3. a transient upstream failure is NOT cached (next view retries)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBtcBalance } from "../btc";

const STX = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const BTC = "bc1qexampleexampleexampleexampleexampleex";

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

/** Build a Hiro /balances response with the given sBTC balance string. */
function balancesResponse(sbtcBalance: string) {
  // Asset id must match SBTC_ASSET_ID built in btc.ts from SBTC_CONTRACTS.mainnet.
  return {
    ok: true,
    json: async () => ({
      fungible_tokens: {
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token": {
          balance: sbtcBalance,
        },
      },
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBtcBalance — L2 sBTC cache", () => {
  it("serves the L2 balance from KV without calling Hiro on a cache hit", async () => {
    const kv = mockKv({ [`cache:sbtc-balance:${STX}`]: "123456" });
    const fetchSpy = vi.fn(async (url: string) => {
      // L1 leg (mempool.space) is allowed; L2 (Hiro) must NOT be hit.
      if (url.includes("mempool.space")) {
        return { ok: true, json: async () => ({ chain_stats: {} }) };
      }
      throw new Error("Hiro should not be called on an L2 cache hit");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(123456);
    // No Hiro call — only the L1 mempool.space fetch happened.
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/balances"),
      expect.anything(),
    );
  });

  it("writes a fresh L2 answer (incl. genuine 0) to KV with a TTL", async () => {
    const kv = mockKv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("mempool.space")) {
          return { ok: true, json: async () => ({ chain_stats: {} }) };
        }
        return balancesResponse("0"); // genuine zero balance
      }),
    );

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(0);
    expect(kv.put).toHaveBeenCalledWith(
      `cache:sbtc-balance:${STX}`,
      "0",
      { expirationTtl: 90 },
    );
  });

  it("does NOT cache a transient Hiro failure", async () => {
    const kv = mockKv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("mempool.space")) {
          return { ok: true, json: async () => ({ chain_stats: {} }) };
        }
        return { ok: false, json: async () => ({}) }; // Hiro 5xx/429
      }),
    );

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key", kv);
    expect(bal.l2Sats).toBe(0);
    // Nothing written — the next profile view will retry the upstream.
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("still works with no KV binding (falls straight through to Hiro)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("mempool.space")) {
          return { ok: true, json: async () => ({ chain_stats: {} }) };
        }
        return balancesResponse("777");
      }),
    );

    const bal = await fetchBtcBalance(BTC, STX, "hiro-key");
    expect(bal.l2Sats).toBe(777);
  });
});
