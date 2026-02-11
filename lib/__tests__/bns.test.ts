import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBnsName } from "../bns";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("lookupBnsName", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("success cases", () => {
    it("returns BNS name when API returns names array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["alice.btc"] }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBe("alice.btc");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.hiro.so/v1/addresses/stacks/SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it("returns first name when multiple names exist", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["alice.btc", "bob.btc", "charlie.btc"] }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBe("alice.btc");
    });

    it("calls API with correct URL format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["test.btc"] }),
      });

      const testAddress = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
      await lookupBnsName(testAddress);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.hiro.so/v1/addresses/stacks/${testAddress}`,
        expect.any(Object)
      );
    });

    it("includes abort signal with timeout", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["test.btc"] }),
      });

      await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe("fallback to null cases", () => {
    it("returns null when API returns empty names array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: [] }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when API returns no names field", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when API returns null names", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: null }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when API response is not ok", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when API response is 500", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when fetch throws network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when fetch times out", async () => {
      mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });

    it("returns null when response structure is unexpected", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => "unexpected string response",
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("does not throw on network errors", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });

    it("does not throw on timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("Timeout", "TimeoutError"));

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });

    it("does not throw on invalid response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      await expect(
        lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).resolves.toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles testnet addresses", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["testnet.btc"] }),
      });

      const result = await lookupBnsName("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
      expect(result).toBe("testnet.btc");
    });

    it("handles very long BNS names", async () => {
      const longName = "a".repeat(100) + ".btc";
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: [longName] }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBe(longName);
    });

    it("handles special characters in BNS names", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["test-name_123.btc"] }),
      });

      const result = await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(result).toBe("test-name_123.btc");
    });

    it("makes only one API call per invocation", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ names: ["test.btc"] }),
      });

      await lookupBnsName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
