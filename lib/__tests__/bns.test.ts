import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBnsName } from "../bns";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

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
    json: async () => ({ okay: true, result }),
  };
}

function mockV2None() {
  // (ok none) = 0x07 09
  return {
    ok: true,
    json: async () => ({ okay: true, result: "0x0709" }),
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
        "https://api.hiro.so/v2/contracts/call-read/SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF/BNS-V2/get-primary",
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
    it("returns null when V2 returns none (no primary name)", async () => {
      mockFetch.mockResolvedValue(mockV2None());

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when API response is not ok", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when API response is 500", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await lookupBnsName(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
      );
      expect(result).toBeNull();
    });

    it("returns null when okay is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
        json: async () => ({ okay: true, result: "0xdeadbeef" }),
      });

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
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
