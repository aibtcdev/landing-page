import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBnsName, lookupBnsNameWithOutcome } from "../bns";

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

    it("writes short-TTL negative cache on upstream !res.ok", async () => {
      const kv = createMockKv();
      // 500 is retried up to retries=2, so return 500 every time
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: mockHeaders(),
      });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });

    it("writes 5-min contract-error cache on !data.okay", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: false, result: "some error" }),
      });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      // Contract-reported errors use the 5-min TTL (BNS_CONTRACT_ERROR_CACHE_TTL),
      // distinct from the 60s transient-upstream TTL — contract errors on valid
      // input are effectively deterministic, so re-hitting Hiro every 60s is waste.
      expect(kv._store.get(cacheKey)?.ttl).toBe(5 * 60);
    });

    it("writes short-TTL negative cache on network error", async () => {
      const kv = createMockKv();
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });

    it("does not re-hit Hiro after negative cache is warmed", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: mockHeaders(),
      });

      await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      const fetchCountAfterFirst = mockFetch.mock.calls.length;
      mockFetch.mockClear();

      // Second call — negative cache should suppress the Hiro request entirely
      await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(fetchCountAfterFirst).toBeGreaterThan(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("writes 7d confirmed-negative cache when V2 returns err u131", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue(mockV2ErrNoPrimary());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      // 7d (604800s) TTL — confirmed "no primary name" per the three-state model.
      // ERR-NO-PRIMARY-NAME is the real BNS-V2 response for nameless addresses.
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(7 * 24 * 60 * 60);
    });

    it("writes 7d confirmed-negative cache when V2 returns (ok none) [defense-in-depth]", async () => {
      const kv = createMockKv();
      mockFetch.mockResolvedValue(mockV2None());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(7 * 24 * 60 * 60);
    });

    it("writes 60s lookup-failed cache on unexpected err code (not u131)", async () => {
      const kv = createMockKv();
      // ERR-UNWRAP (u101) or any other non-u131 error is treated as a
      // genuine malformed response — short-TTL defer rather than 7d pin.
      mockFetch.mockResolvedValue(mockV2ErrOther(101));

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(result).toBeNull();
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.value).toBe("__NONE__");
      expect(kv._store.get(cacheKey)?.ttl).toBe(60);
    });
  });

  describe("tri-state outcome (lookupBnsNameWithOutcome)", () => {
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
      const kv = createMockKv();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({ okay: false, result: "err" }),
      });
      const outcome = await lookupBnsNameWithOutcome(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        undefined,
        kv as unknown as KVNamespace
      );
      expect(outcome).toEqual({ state: "lookup-failed", name: null });
      // Contract-error TTL should be the 5-min variant, not 60s.
      const cacheKey = "cache:bns:SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
      expect(kv._store.get(cacheKey)?.ttl).toBe(5 * 60);
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
