import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { provisionSponsorKey } from "../provision";
import type { Logger } from "@/lib/logging";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("provisionSponsorKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("success cases", () => {
    it("returns apiKey on successful provisioning", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ apiKey: "sk_test_abc123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        "H7sI1xVBBz...",
        "Bitcoin will be the currency of AIs",
        "https://x402-relay.aibtc.com",
        mockLogger
      );

      expect(result).toEqual({ success: true, apiKey: "sk_test_abc123" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://x402-relay.aibtc.com/keys/provision",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            btcAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            signature: "H7sI1xVBBz...",
            message: "Bitcoin will be the currency of AIs",
          }),
          signal: expect.any(AbortSignal),
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Sponsor key provisioned",
        { btcAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }
      );
    });

    it("handles different relay URLs correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ apiKey: "sk_prod_xyz789" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest",
        "sig123",
        "test message",
        "https://custom-relay.example.com",
        mockLogger
      );

      expect(result).toEqual({ success: true, apiKey: "sk_prod_xyz789" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-relay.example.com/keys/provision",
        expect.any(Object)
      );
    });
  });

  describe("graceful degradation", () => {
    it("returns error on 400 bad request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Invalid signature",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "bad-sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result).toEqual({ success: false, error: "Invalid signature", status: 400 });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Sponsor key provisioning failed",
        expect.objectContaining({ status: 400, error: "Invalid signature" })
      );
    });

    it("returns error on 409 conflict", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => "Address already has a key",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qexisting", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result).toEqual({ success: false, error: "Address already has a key", status: 409 });
    });

    it("returns error on 500 server error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result).toEqual({ success: false, error: "Internal server error", status: 500 });
    });

    it("returns error when relay returns unexpected response shape", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ key: "wrong-field-name" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Unexpected response");
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Sponsor relay returned unexpected response shape",
        { btcAddress: "bc1qtest" }
      );
    });

    it("returns error when relay returns null apiKey", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ apiKey: null }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
    });
  });

  describe("network error handling", () => {
    it("handles fetch throwing network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Network timeout");
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Sponsor key provisioning exception",
        expect.objectContaining({ error: expect.stringContaining("Network timeout") })
      );
    });

    it("handles fetch throwing TypeError (network failure)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Failed to fetch");
      }
    });

    it("handles relay being unreachable", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND relay.example.com"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("ENOTFOUND");
      }
    });

    it("handles AbortSignal timeout (slow relay)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("aborted");
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Sponsor key provisioning exception",
        expect.objectContaining({ btcAddress: "bc1qtest" })
      );
    });
  });

  describe("logging", () => {
    it("logs debug message on start", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ apiKey: "sk_test" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Provisioning sponsor key",
        { btcAddress: "bc1qtest", relayUrl: "https://relay.example.com" }
      );
    });

    it("logs error details on exception", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
      vi.stubGlobal("fetch", mockFetch);

      await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Sponsor key provisioning exception",
        { error: "Error: Connection refused", btcAddress: "bc1qtest" }
      );
    });
  });

  describe("fetch options", () => {
    it("passes AbortSignal.timeout to fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ apiKey: "sk_test" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await provisionSponsorKey(
        "bc1qtest", "sig", "message",
        "https://relay.example.com", mockLogger
      );

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
