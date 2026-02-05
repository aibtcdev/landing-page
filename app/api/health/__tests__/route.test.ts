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

// Mock Cloudflare context
const mockContext = {
  getCloudflareContext: vi.fn(),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => mockContext.getCloudflareContext(),
}));

describe("GET /api/health", () => {
  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockContext.getCloudflareContext.mockResolvedValue(
      mockCloudflareContext(mockKV)
    );
    vi.clearAllMocks();
  });

  describe("healthy state", () => {
    it("returns 200 when KV is accessible", async () => {
      const response = await GET();
      expect(response.status).toBe(200);
    });

    it("returns status 'healthy' when KV is accessible", async () => {
      const response = await GET();
      const data = await response.json();
      expect(data.status).toBe("healthy");
    });

    it("returns correct response structure", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("timestamp");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("services");
      expect(data.services).toHaveProperty("kv");
      expect(data.services.kv).toHaveProperty("status");
    });

    it("returns ISO 8601 timestamp", async () => {
      const response = await GET();
      const data = await response.json();

      const date = new Date(data.timestamp);
      expect(date.toISOString()).toBe(data.timestamp);
    });

    it("returns version string", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.version).toBe("1.0.0");
    });

    it("returns KV status 'connected' when accessible", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.services.kv.status).toBe("connected");
    });
  });

  describe("agent count", () => {
    it("returns agentCount 0 when no agents registered", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.services.kv.agentCount).toBe(0);
    });

    it("returns correct agentCount with registered agents", async () => {
      const agent1 = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
      });
      const agent2 = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS_2,
        btcAddress: SAMPLE_BTC_ADDRESS_2,
      });

      await mockKV.put(`stx:${agent1.stxAddress}`, JSON.stringify(agent1));
      await mockKV.put(`btc:${agent1.btcAddress}`, JSON.stringify(agent1));
      await mockKV.put(`stx:${agent2.stxAddress}`, JSON.stringify(agent2));
      await mockKV.put(`btc:${agent2.btcAddress}`, JSON.stringify(agent2));

      const response = await GET();
      const data = await response.json();

      // Should count only stx: prefixed keys (2 agents, not 4 keys)
      expect(data.services.kv.agentCount).toBe(2);
    });
  });

  describe("degraded state", () => {
    it("returns 503 when KV is unavailable", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("KV unavailable")
      );

      const response = await GET();
      expect(response.status).toBe(503);
    });

    it("returns status 'degraded' when KV is unavailable", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("KV unavailable")
      );

      const response = await GET();
      const data = await response.json();

      expect(data.status).toBe("degraded");
    });

    it("includes KV error message when degraded", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("Connection refused")
      );

      const response = await GET();
      const data = await response.json();

      expect(data.services.kv.status).toBe("error");
      expect(data.services.kv.error).toBe("Connection refused");
    });

    it("still returns timestamp and version when degraded", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("KV unavailable")
      );

      const response = await GET();
      const data = await response.json();

      expect(data.timestamp).toBeDefined();
      expect(data.version).toBe("1.0.0");
    });
  });

  describe("cache headers", () => {
    it("sets no-cache headers (health should never be cached)", async () => {
      const response = await GET();
      const cacheControl = response.headers.get("cache-control");

      expect(cacheControl).toContain("no-cache");
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("must-revalidate");
    });
  });

  describe("content type", () => {
    it("returns application/json", async () => {
      const response = await GET();
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });
});
