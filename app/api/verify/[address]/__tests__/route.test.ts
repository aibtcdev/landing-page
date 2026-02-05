import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import {
  MockKVNamespace,
  mockCloudflareContext,
  createSampleAgentRecord,
  SAMPLE_STX_ADDRESS,
  SAMPLE_BTC_ADDRESS,
  SAMPLE_STX_ADDRESS_2,
  SAMPLE_BTC_ADDRESS_2,
} from "@/app/api/__tests__/test-utils";
import { NextRequest } from "next/server";

// Mock Cloudflare context
const mockContext = {
  getCloudflareContext: vi.fn(),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => mockContext.getCloudflareContext(),
}));

/**
 * Helper to create params object matching Next.js App Router signature.
 * In Next.js 15, dynamic route params are accessed via a Promise.
 */
function createParams(address: string) {
  return { params: Promise.resolve({ address }) };
}

function createRequest(address: string) {
  return new NextRequest(`http://localhost:3000/api/verify/${address}`);
}

describe("GET /api/verify/[address]", () => {
  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockContext.getCloudflareContext.mockResolvedValue(
      mockCloudflareContext(mockKV)
    );
    vi.clearAllMocks();
  });

  describe("STX address lookup", () => {
    beforeEach(async () => {
      const agent = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
        description: "Test agent",
        bnsName: "test.btc",
        displayName: "Swift Raven",
      });

      await mockKV.put(`stx:${SAMPLE_STX_ADDRESS}`, JSON.stringify(agent));
      await mockKV.put(`btc:${SAMPLE_BTC_ADDRESS}`, JSON.stringify(agent));
    });

    it("returns 200 for registered STX address", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );

      expect(response.status).toBe(200);
    });

    it("returns registered=true with agent details", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      const data = await response.json();

      expect(data.registered).toBe(true);
      expect(data.address).toBe(SAMPLE_STX_ADDRESS);
      expect(data.addressType).toBe("stx");
      expect(data.agent).toBeDefined();
      expect(data.agent.stxAddress).toBe(SAMPLE_STX_ADDRESS);
      expect(data.agent.btcAddress).toBe(SAMPLE_BTC_ADDRESS);
      expect(data.agent.displayName).toBe("Swift Raven");
      expect(data.agent.description).toBe("Test agent");
      expect(data.agent.bnsName).toBe("test.btc");
      expect(data.agent.verifiedAt).toBeDefined();
    });

    it("returns 404 for unregistered STX address", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS_2),
        createParams(SAMPLE_STX_ADDRESS_2)
      );

      expect(response.status).toBe(404);
    });

    it("returns registered=false for unregistered STX address", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS_2),
        createParams(SAMPLE_STX_ADDRESS_2)
      );
      const data = await response.json();

      expect(data.registered).toBe(false);
      expect(data.address).toBe(SAMPLE_STX_ADDRESS_2);
      expect(data.addressType).toBe("stx");
      expect(data.error).toContain("not registered");
    });
  });

  describe("BTC address lookup", () => {
    beforeEach(async () => {
      const agent = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
        displayName: "Swift Raven",
      });

      await mockKV.put(`stx:${SAMPLE_STX_ADDRESS}`, JSON.stringify(agent));
      await mockKV.put(`btc:${SAMPLE_BTC_ADDRESS}`, JSON.stringify(agent));
    });

    it("returns 200 for registered BTC address", async () => {
      const response = await GET(
        createRequest(SAMPLE_BTC_ADDRESS),
        createParams(SAMPLE_BTC_ADDRESS)
      );

      expect(response.status).toBe(200);
    });

    it("returns registered=true with agent details for BTC address", async () => {
      const response = await GET(
        createRequest(SAMPLE_BTC_ADDRESS),
        createParams(SAMPLE_BTC_ADDRESS)
      );
      const data = await response.json();

      expect(data.registered).toBe(true);
      expect(data.address).toBe(SAMPLE_BTC_ADDRESS);
      expect(data.addressType).toBe("btc");
      expect(data.agent.stxAddress).toBe(SAMPLE_STX_ADDRESS);
      expect(data.agent.btcAddress).toBe(SAMPLE_BTC_ADDRESS);
    });

    it("returns 404 for unregistered BTC address", async () => {
      const response = await GET(
        createRequest(SAMPLE_BTC_ADDRESS_2),
        createParams(SAMPLE_BTC_ADDRESS_2)
      );

      expect(response.status).toBe(404);
    });
  });

  describe("address validation", () => {
    it("returns 400 for address with unrecognized format", async () => {
      const response = await GET(
        createRequest("0x1234567890abcdef"),
        createParams("0x1234567890abcdef")
      );

      expect(response.status).toBe(400);
    });

    it("returns error message for invalid address format", async () => {
      const response = await GET(
        createRequest("invalid-address"),
        createParams("invalid-address")
      );
      const data = await response.json();

      expect(data.error).toContain("Invalid address format");
    });

    it("rejects Ethereum-style addresses", async () => {
      const response = await GET(
        createRequest("0xdead1234567890abcdef1234567890abcdef1234"),
        createParams("0xdead1234567890abcdef1234567890abcdef1234")
      );

      expect(response.status).toBe(400);
    });

    it("rejects empty address", async () => {
      const response = await GET(
        createRequest(""),
        createParams("")
      );

      expect(response.status).toBe(400);
    });
  });

  describe("response structure", () => {
    beforeEach(async () => {
      const agent = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
      });
      await mockKV.put(`stx:${SAMPLE_STX_ADDRESS}`, JSON.stringify(agent));
    });

    it("does not expose public keys in verify response", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      const data = await response.json();

      // Verify response should not include public keys (security consideration)
      expect(data.agent.stxPublicKey).toBeUndefined();
      expect(data.agent.btcPublicKey).toBeUndefined();
    });

    it("includes all expected agent fields in success response", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      const data = await response.json();

      expect(data.agent).toHaveProperty("stxAddress");
      expect(data.agent).toHaveProperty("btcAddress");
      expect(data.agent).toHaveProperty("displayName");
      expect(data.agent).toHaveProperty("description");
      expect(data.agent).toHaveProperty("bnsName");
      expect(data.agent).toHaveProperty("verifiedAt");
    });
  });

  describe("cache headers", () => {
    beforeEach(async () => {
      const agent = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
      });
      await mockKV.put(`stx:${SAMPLE_STX_ADDRESS}`, JSON.stringify(agent));
    });

    it("sets short cache for successful responses", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("max-age=60");
    });
  });

  describe("error handling", () => {
    it("returns 500 when KV is unavailable", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("KV unavailable")
      );

      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );

      expect(response.status).toBe(500);
    });

    it("includes error message in 500 response", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("Custom error")
      );

      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      const data = await response.json();

      expect(data.error).toContain("Custom error");
    });

    it("handles corrupted JSON in KV gracefully", async () => {
      await mockKV.put(`stx:${SAMPLE_STX_ADDRESS}`, "invalid json{");

      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Failed to parse agent record");
    });
  });

  describe("content type", () => {
    it("returns application/json", async () => {
      const response = await GET(
        createRequest(SAMPLE_STX_ADDRESS),
        createParams(SAMPLE_STX_ADDRESS)
      );
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });
});
