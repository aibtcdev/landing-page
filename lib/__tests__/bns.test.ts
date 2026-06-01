import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBnsName, lookupBnsNameWithOutcome, lookupOwnerByBnsName } from "../bns";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

/** Minimal headers mock that satisfies stacksApiFetch's extractRateLimitInfo. */
function mockHeaders(): Headers {
  return { get: () => null } as unknown as Headers;
}

/**
 * Build a mock Hiro API response for BNS-V2 get-primary.
 * Constructs the actual Clarity hex that @stacks/transactions can deserialize.
 *
 * Format: (ok (some { name: (buff N), namespace: (buff M) }))
 * Hex:    07 0a 0c 00000002 04"name" 02{len}{data} 09"namespace" 02{len}{data}
 */
function mockV2Response(name: string, namespace: string) {
  const nameBuf = Buffer.from(name, "utf-8").toString("hex");
  const nsBuf = Buffer.from(namespace, "utf-8").toString("hex");
  const nameLen = name.length.toString(16).padStart(8, "0");
  const nsLen = namespace.length.toString(16).padStart(8, "0");

  // Clarity tuple keys are length-prefixed ASCII
  // "name" = 04 6e616d65, "namespace" = 09 6e616d657370616365
  const result =
    "0x07" + // response ok
    "0a" + // some
    "0c" + // tuple
    "00000002" + // 2 fields
    "04" + "6e616d65" + // key "name" (len=4)
    "02" + nameLen + nameBuf + // buffer value
    "09" + "6e616d657370616365" + // key "namespace" (len=9)
    "02" + nsLen + nsBuf; // buffer value

  return {
    ok: true,
    status: 200,
    headers: mockHeaders(),
    json: async () => ({ okay: true, result }),
  };
}

function mockV2None() {
  // Defense-in-depth path: (ok none) = 0x07 09. BNS-V2 doesn't actually
  // return this today (see mockV2ErrNoPrimary) but the parser keeps the
  // branch in case the contract signature ever changes.
  return {
    ok: true,
    status: 200,
    headers: mockHeaders(),
    json: async () => ({ okay: true, result: "0x0709" }),
  };
}

function mockV2ErrNoPrimary() {
  // Real BNS-V2 response for an address with no primary name:
  // (err u131) ERR-NO-PRIMARY-NAME = 0x08 01 00...00 83
  return {
    ok: true,
    status: 200,
    headers: mockHeaders(),
    json: async () => ({
      okay: true,
      result: "0x080100000000000000000000000000000083",
    }),
  };
}

function mockV2ErrOther(code: number) {
  // Any other (err uN) — treated as a genuine malformed/unexpected response.
  // `code` is encoded as a Clarity u128 (16 bytes / 32 hex chars), so any
  // value in [0, 2^128 - 1] is representable. JS `number` safely covers up
  // to 2^53 - 1, which is far more than any plausible contract error code;
  // u131 (ERR-NO-PRIMARY-NAME) is the only code we currently special-case,
  // so callers pass small example codes like 101 here.
  const hex = code.toString(16).padStart(32, "0");
  return {
    ok: true,
    status: 200,
    headers: mockHeaders(),
    json: async () => ({ okay: true, result: "0x0801" + hex }),
  };
}

describe("lookupBnsName", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("success cases", () => {
    it("returns BNS name from V2 contract", async () => {
      mockFetch.mockResolvedValue(mockV2Response("alice", "btc"));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBe("alice.btc");
    });

    it("calls BNS-V2 contract read-only endpoint", async () => {
      mockFetch.mockResolvedValue(mockV2Response("test", "btc"));

      await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.mainnet.hiro.so/v2/contracts/call-read/SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF/BNS-V2/get-primary",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: expect.any(AbortSignal),
        })
      );
    });

    it("handles non-btc namespaces", async () => {
      mockFetch.mockResolvedValue(mockV2Response("myname", "stx"));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBe("myname.stx");
    });
  });

  describe("fallback to null cases", () => {
    it("returns null when V2 returns err u131 (no primary name)", async () => {
      mockFetch.mockResolvedValue(mockV2ErrNoPrimary());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when V2 returns (ok none) [defense-in-depth]", async () => {
      mockFetch.mockResolvedValue(mockV2None());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when API response is not ok", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, headers: mockHeaders() });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when API response is 500", async () => {
      // 500 is retried by stacksApiFetch (up to 3 attempts) — all return 500 here
      mockFetch.mockResolvedValue({ ok: false, status: 500, headers: mockHeaders() });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when okay is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: false, result: "some error" }),
      });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("does not throw on network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });

    it("does not throw on timeout", async () => {
      mockFetch.mockRejectedValue(
        new DOMException("Aborted", "AbortError")
      );

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });

    it("does not throw on JSON parse failure", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });

    it("does not throw on invalid Clarity value", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: true, result: "0xdeadbeef" }),
      });

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });
  });

  describe("failure negative caching", () => {
    // Note: BNS/identity cache writes now go to D1 + caches.default
    // (migration 013_identity_cache.sql, PR #762-B). KV is no longer
    // the write target for cache:bns:* keys. Tests verify return values
    // (the observable contract) rather than storage internals.

    it("returns null on upstream !res.ok (lookup-failed state)", async () => {
      // 500 is retried up to retries=2, so return 500 every time
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: mockHeaders(),
      });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null on !data.okay (contract-error state)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: false, result: "some error" }),
      });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      // Contract-reported errors use the 5-min TTL (BNS_CONTRACT_ERROR_CACHE_TTL)
      // stored in D1 — distinct from the 60s transient-upstream TTL. Return is
      // null in both cases; TTL distinction is enforced at the D1 layer.
      expect(result).toBeNull();
    });

    it("returns null on network error (lookup-failed state)", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null on err u131 (confirmed-negative state)", async () => {
      mockFetch.mockResolvedValue(mockV2ErrNoPrimary());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      // 6h TTL stored in D1 — confirmed "no primary name" per three-state model.
      // ERR-NO-PRIMARY-NAME is the real BNS-V2 response for nameless addresses.
      expect(result).toBeNull();
    });

    it("returns null on (ok none) [defense-in-depth, confirmed-negative state]", async () => {
      mockFetch.mockResolvedValue(mockV2None());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      // 6h TTL stored in D1. Defense-in-depth branch.
      expect(result).toBeNull();
    });

    it("returns null on unexpected err code (lookup-failed state, 60s D1 TTL)", async () => {
      // ERR-UNWRAP (u101) or any other non-u131 error is treated as a
      // genuine malformed response — short-TTL defer rather than 6h pin.
      mockFetch.mockResolvedValue(mockV2ErrOther(101));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("writes different Cache-Control max-age for contract-error (5min) vs lookup-failed (60s)", async () => {
      // The 'contract-error' state was added in this migration so the row
      // reflects which branch wrote it. Verify the TTL distinction at the
      // observable boundary: the Cache-Control header the cache layer writes.
      const store = new Map<string, Response>();
      const captured: { key: string; maxAge: number }[] = [];
      const cacheMock = {
        match: vi.fn(async (req: Request) => {
          const key = typeof req === "string" ? req : req.url;
          const r = store.get(key);
          return r ? r.clone() : undefined;
        }),
        put: vi.fn(async (req: Request, res: Response) => {
          const key = typeof req === "string" ? req : req.url;
          const cc = res.headers.get("Cache-Control") ?? "";
          const m = cc.match(/max-age=(\d+)/);
          if (m) captured.push({ key, maxAge: Number(m[1]) });
          store.set(key, res.clone());
        }),
        delete: vi.fn(async (req: Request) => {
          const key = typeof req === "string" ? req : req.url;
          return store.delete(key);
        }),
      };
      const prevCaches = (globalThis as unknown as Record<string, unknown>)
        .caches;
      (globalThis as unknown as Record<string, unknown>).caches = {
        default: cacheMock,
      };

      try {
        // Contract-error branch: Hiro returns {okay:false}. Expect 5min TTL.
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: mockHeaders(),
          json: async () => ({ okay: false, result: "some error" }),
        });
        await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");

        // Lookup-failed branch: Hiro 500. Expect 60s TTL. Use a different
        // address so we don't hit the warmed cache from the previous call.
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          headers: mockHeaders(),
        });
        await lookupBnsName("SP1HNK0F18S5J7BMHQA72E1QBKD3K3T56AVMZS3E9");

        const writes = captured.map((c) => c.maxAge);
        expect(writes).toContain(5 * 60); // BNS_CONTRACT_ERROR_CACHE_TTL
        expect(writes).toContain(60); // BNS_LOOKUP_FAILED_CACHE_TTL
        expect(5 * 60).not.toBe(60); // Sanity: the two TTLs are distinct.
      } finally {
        if (prevCaches === undefined) {
          delete (globalThis as unknown as Record<string, unknown>).caches;
        } else {
          (globalThis as unknown as Record<string, unknown>).caches =
            prevCaches;
        }
      }
    });

    it("does not re-hit Hiro after negative cache is warmed (D1 + caches.default)", async () => {
      // End-to-end behavioral coverage for the D1 + caches.default cache
      // path: a 500 from Hiro warms the negative cache; a second
      // lookupBnsName call for the same address must be served from cache
      // without re-hitting fetch. We mock globalThis.caches.default with an
      // in-memory store; getCloudflareContext is unavailable in this Node
      // test env so d1Get/d1Put are no-ops — caches.default carries the
      // entry, which is sufficient to exercise the suppress-re-hit contract.
      const store = new Map<string, Response>();
      const cacheMock = {
        match: vi.fn(async (req: Request) => {
          const key = typeof req === "string" ? req : req.url;
          const r = store.get(key);
          return r ? r.clone() : undefined;
        }),
        put: vi.fn(async (req: Request, res: Response) => {
          const key = typeof req === "string" ? req : req.url;
          store.set(key, res.clone());
        }),
        delete: vi.fn(async (req: Request) => {
          const key = typeof req === "string" ? req : req.url;
          return store.delete(key);
        }),
      };
      const prevCaches = (globalThis as unknown as Record<string, unknown>)
        .caches;
      (globalThis as unknown as Record<string, unknown>).caches = {
        default: cacheMock,
      };

      try {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          headers: mockHeaders(),
        });

        await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
        const fetchCountAfterFirst = mockFetch.mock.calls.length;
        mockFetch.mockClear();

        // Second call — warmed negative cache should suppress the Hiro
        // request entirely.
        await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
        expect(fetchCountAfterFirst).toBeGreaterThan(0);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        if (prevCaches === undefined) {
          delete (globalThis as unknown as Record<string, unknown>).caches;
        } else {
          (globalThis as unknown as Record<string, unknown>).caches =
            prevCaches;
        }
      }
    });
  });

  describe("tri-state outcome (lookupBnsNameWithOutcome)", () => {
    it("returns positive outcome on successful lookup", async () => {
      mockFetch.mockResolvedValue(mockV2Response("alice", "btc"));
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "positive", name: "alice.btc" });
    });

    it("returns confirmed-negative outcome on err u131 (no primary name)", async () => {
      mockFetch.mockResolvedValue(mockV2ErrNoPrimary());
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "confirmed-negative", name: null });
    });

    it("returns confirmed-negative outcome on (ok none) [defense-in-depth]", async () => {
      mockFetch.mockResolvedValue(mockV2None());
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "confirmed-negative", name: null });
    });

    it("returns lookup-failed outcome on upstream error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: mockHeaders(),
      });
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "lookup-failed", name: null });
    });

    it("returns lookup-failed outcome on !data.okay (contract error)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: false, result: "err" }),
      });
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "lookup-failed", name: null });
      // Contract-error uses a 5-min D1 TTL (BNS_CONTRACT_ERROR_CACHE_TTL),
      // distinct from the 60s lookup-failed TTL — enforced at D1 write time.
    });

    it("returns lookup-failed outcome on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(outcome).toEqual({ state: "lookup-failed", name: null });
    });
  });

  describe("edge cases", () => {
    it("makes only one API call per invocation", async () => {
      mockFetch.mockResolvedValue(mockV2Response("test", "btc"));

      await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends serialized principal CV in arguments", async () => {
      mockFetch.mockResolvedValue(mockV2Response("test", "btc"));

      await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0][1] as any).body
      );
      expect(callBody.arguments).toHaveLength(1);
      expect(callBody.arguments[0]).toMatch(/^0x05/); // principal CV prefix
      expect(callBody.sender).toBe(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// lookupOwnerByBnsName — reverse BNS lookup (name → STX address)
// ---------------------------------------------------------------------------

describe("lookupOwnerByBnsName", () => {
  /** Build an in-memory KV mock that records put() calls. */
  function createMockKv() {
    const store = new Map<string, { value: string; ttl?: number }>();
    return {
      get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
      put: vi.fn(
        async (
          key: string,
          value: string,
          options?: { expirationTtl?: number }
        ) => {
          store.set(key, { value, ttl: options?.expirationTtl });
        }
      ),
      _store: store,
    };
  }

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("positive cache (24h)", () => {
    it("returns the owner STX address on a successful Hiro response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", zonefile_hash: "abc" }),
      });

      const result = await lookupOwnerByBnsName("alice.btc");
      expect(result).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
    });

    it("caches the owner address with a 24h TTL", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" }),
      });

      await lookupOwnerByBnsName("alice.btc", undefined, kv as unknown as KVNamespace);

      const cacheKey = "cache:bns-owner:alice.btc";
      expect(kv._store.get(cacheKey)?.value).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(kv._store.get(cacheKey)?.ttl).toBe(24 * 60 * 60);
    });

    it("returns the cached address without hitting Hiro on a cache hit", async () => {
      const kv = createMockKv();
      // Pre-seed the cache
      kv._store.set("cache:bns-owner:alice.btc", { value: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" });

      const result = await lookupOwnerByBnsName("alice.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls the correct Hiro v1/names endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" }),
      });

      await lookupOwnerByBnsName("alice.btc");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.mainnet.hiro.so/v1/names/alice.btc",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe("confirmed-negative cache (7d) — name does not exist", () => {
    it("returns null on 404 and caches with 7d TTL", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: mockHeaders(),
      });

      const result = await lookupOwnerByBnsName("noname.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBeNull();
      const cacheKey = "cache:bns-owner:noname.btc";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(7 * 24 * 60 * 60);
    });

    it("serves null from negative cache without hitting Hiro again", async () => {
      const kv = createMockKv();
      kv._store.set("cache:bns-owner:noname.btc", { value: "__NONE__" });

      const result = await lookupOwnerByBnsName("noname.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("lookup-failed cache (60s) — transient upstream errors", () => {
    it("returns null on 5xx and caches with 60s TTL", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: mockHeaders(),
      });

      const result = await lookupOwnerByBnsName("alice.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBeNull();
      const cacheKey = "cache:bns-owner:alice.btc";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });

    it("returns null on network error and caches with 60s TTL", async () => {
      const kv = createMockKv();
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await lookupOwnerByBnsName("alice.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBeNull();
      const cacheKey = "cache:bns-owner:alice.btc";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });

    it("returns null when response has no address field and caches 60s TTL", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ zonefile_hash: "abc" }), // no address field
      });

      const result = await lookupOwnerByBnsName("alice.btc", undefined, kv as unknown as KVNamespace);

      expect(result).toBeNull();
      const cacheKey = "cache:bns-owner:alice.btc";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });

    it("does not throw on timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

      await expect(
        lookupOwnerByBnsName("alice.btc")
      ).resolves.toBeNull();
    });
  });
});
