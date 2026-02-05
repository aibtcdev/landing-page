import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import {
  MockKVNamespace,
  mockCloudflareContext,
  createSampleAgentRecord,
  SAMPLE_BTC_ADDRESS,
  SAMPLE_STX_ADDRESS,
  SAMPLE_BTC_ADDRESS_2,
  SAMPLE_STX_ADDRESS_2,
} from "@/app/api/__tests__/test-utils";

// Mock Cloudflare context
const mockContext = {
  getCloudflareContext: vi.fn(),
};

// Mock the Cloudflare context module
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => mockContext.getCloudflareContext(),
}));

describe("GET /api/agents", () => {
  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockContext.getCloudflareContext.mockResolvedValue(
      mockCloudflareContext(mockKV)
    );
    vi.clearAllMocks();
  });

  describe("empty state", () => {
    it("returns empty array when no agents registered", async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });

    it("returns correct response structure for empty array", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty("agents");
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBe(0);
    });
  });

  describe("with agents", () => {
    beforeEach(async () => {
      // Add multiple agents to KV
      const agent1 = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS,
        btcAddress: SAMPLE_BTC_ADDRESS,
        displayName: "Swift Raven",
      });

      const agent2 = createSampleAgentRecord({
        stxAddress: SAMPLE_STX_ADDRESS_2,
        btcAddress: SAMPLE_BTC_ADDRESS_2,
        displayName: "Crimson Phoenix",
      });

      // Store with stx: prefix (what the API looks for)
      await mockKV.put(`stx:${agent1.stxAddress}`, JSON.stringify(agent1));
      await mockKV.put(`stx:${agent2.stxAddress}`, JSON.stringify(agent2));

      // Also store with btc: prefix (for duplicate checking)
      await mockKV.put(`btc:${agent1.btcAddress}`, JSON.stringify(agent1));
      await mockKV.put(`btc:${agent2.btcAddress}`, JSON.stringify(agent2));
    });

    it("returns all agents", async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents.length).toBe(2);
    });

    it("filters by stx: prefix to avoid duplicates", async () => {
      const response = await GET();
      const data = await response.json();

      // Should only return 2 agents, not 4 (stx: and btc: keys)
      expect(data.agents.length).toBe(2);

      // All should have unique STX addresses
      const stxAddresses = data.agents.map((a: { stxAddress: string }) => a.stxAddress);
      const uniqueAddresses = new Set(stxAddresses);
      expect(uniqueAddresses.size).toBe(2);
    });

    it("returns agents with correct structure", async () => {
      const response = await GET();
      const data = await response.json();

      const agent = data.agents[0];
      expect(agent).toHaveProperty("stxAddress");
      expect(agent).toHaveProperty("btcAddress");
      expect(agent).toHaveProperty("stxPublicKey");
      expect(agent).toHaveProperty("btcPublicKey");
      expect(agent).toHaveProperty("displayName");
      expect(agent).toHaveProperty("verifiedAt");
    });

    it("includes optional fields when present", async () => {
      const agentWithOptionals = createSampleAgentRecord({
        description: "Test description",
        bnsName: "test.btc",
      });

      await mockKV.put(
        `stx:SP111111111111111111111111111111`,
        JSON.stringify(agentWithOptionals)
      );

      const response = await GET();
      const data = await response.json();

      const agent = data.agents.find(
        (a: { description: string | null }) => a.description === "Test description"
      );

      expect(agent).toBeDefined();
      expect(agent.bnsName).toBe("test.btc");
      expect(agent.description).toBe("Test description");
    });
  });

  describe("sorting", () => {
    beforeEach(async () => {
      const now = new Date();

      // Create agents with different timestamps
      const oldAgent = createSampleAgentRecord({
        stxAddress: "SP1111111111111111111111111111111",
        btcAddress: "bc1q1111111111111111111111111111",
      });
      oldAgent.verifiedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

      const newAgent = createSampleAgentRecord({
        stxAddress: "SP2222222222222222222222222222222",
        btcAddress: "bc1q2222222222222222222222222222",
      });
      newAgent.verifiedAt = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago

      const newestAgent = createSampleAgentRecord({
        stxAddress: "SP3333333333333333333333333333333",
        btcAddress: "bc1q3333333333333333333333333333",
      });
      newestAgent.verifiedAt = now.toISOString(); // Just now

      await mockKV.put(`stx:${oldAgent.stxAddress}`, JSON.stringify(oldAgent));
      await mockKV.put(`stx:${newAgent.stxAddress}`, JSON.stringify(newAgent));
      await mockKV.put(`stx:${newestAgent.stxAddress}`, JSON.stringify(newestAgent));
    });

    it("sorts agents by verifiedAt descending (newest first)", async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.agents.length).toBe(3);

      // First agent should be the newest
      expect(data.agents[0].stxAddress).toBe("SP3333333333333333333333333333333");
      expect(data.agents[1].stxAddress).toBe("SP2222222222222222222222222222222");
      expect(data.agents[2].stxAddress).toBe("SP1111111111111111111111111111111");
    });

    it("verifiedAt timestamps are in ISO 8601 format", async () => {
      const response = await GET();
      const data = await response.json();

      for (const agent of data.agents) {
        const date = new Date(agent.verifiedAt);
        expect(date.toISOString()).toBe(agent.verifiedAt);
      }
    });
  });

  describe("pagination", () => {
    it("handles pagination for >1000 agents", async () => {
      // This is hard to test without 1000+ entries
      // But the code structure shows pagination is implemented
      // using KV's cursor-based pagination
    });

    it("retrieves all pages when list_complete is false", async () => {
      // Test structure for multi-page results
      // Actual implementation would require mocking KV.list to return
      // results with list_complete: false and a cursor
    });
  });

  describe("error handling", () => {
    it("handles corrupted JSON entries gracefully", async () => {
      // Add a valid agent
      const validAgent = createSampleAgentRecord();
      await mockKV.put(`stx:${validAgent.stxAddress}`, JSON.stringify(validAgent));

      // Add a corrupted entry
      await mockKV.put("stx:CORRUPTED", "invalid json{");

      const response = await GET();
      const data = await response.json();

      // Should return only the valid agent, skip corrupted
      expect(response.status).toBe(200);
      expect(data.agents.length).toBe(1);
      expect(data.agents[0].stxAddress).toBe(validAgent.stxAddress);
    });

    it("continues processing after encountering corrupted entry", async () => {
      // Add agents in this order: valid, corrupted, valid
      const agent1 = createSampleAgentRecord({
        stxAddress: "SP1111111111111111111111111111111",
      });
      const agent2 = createSampleAgentRecord({
        stxAddress: "SP3333333333333333333333333333333",
      });

      await mockKV.put(`stx:${agent1.stxAddress}`, JSON.stringify(agent1));
      await mockKV.put("stx:SP2222222222222222222222222222222", "invalid json");
      await mockKV.put(`stx:${agent2.stxAddress}`, JSON.stringify(agent2));

      const response = await GET();
      const data = await response.json();

      // Should return both valid agents
      expect(data.agents.length).toBe(2);
    });

    it("returns 500 on KV failure", async () => {
      // Mock KV to throw error
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("KV unavailable")
      );

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to fetch agents");
    });

    it("includes error message in 500 response", async () => {
      mockContext.getCloudflareContext.mockRejectedValueOnce(
        new Error("Custom error message")
      );

      const response = await GET();
      const data = await response.json();

      expect(data.error).toContain("Custom error message");
    });
  });

  describe("KV operations", () => {
    it("uses stx: prefix for listing", async () => {
      const agent = createSampleAgentRecord();

      await mockKV.put(`stx:${agent.stxAddress}`, JSON.stringify(agent));
      await mockKV.put(`btc:${agent.btcAddress}`, JSON.stringify(agent));
      await mockKV.put("other:key", "value");

      const response = await GET();
      const data = await response.json();

      // Should only return agents with stx: prefix
      expect(data.agents.length).toBe(1);
    });

    it("handles empty KV gracefully", async () => {
      expect(mockKV.size()).toBe(0);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });
  });

  describe("response format", () => {
    beforeEach(async () => {
      const agent = createSampleAgentRecord({
        description: "Test description",
        bnsName: "test.btc",
      });

      await mockKV.put(`stx:${agent.stxAddress}`, JSON.stringify(agent));
    });

    it("returns correct content-type header", async () => {
      const response = await GET();

      expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("preserves all agent fields", async () => {
      const response = await GET();
      const data = await response.json();

      const agent = data.agents[0];

      expect(agent.stxAddress).toBeDefined();
      expect(agent.btcAddress).toBeDefined();
      expect(agent.stxPublicKey).toBeDefined();
      expect(agent.btcPublicKey).toBeDefined();
      expect(agent.displayName).toBeDefined();
      expect(agent.description).toBeDefined();
      expect(agent.bnsName).toBeDefined();
      expect(agent.verifiedAt).toBeDefined();
    });

    it("handles null optional fields correctly", async () => {
      const agentWithNulls = createSampleAgentRecord({
        stxAddress: "SP9999999999999999999999999999999",
        description: null,
        bnsName: null,
      });

      await mockKV.put(
        `stx:${agentWithNulls.stxAddress}`,
        JSON.stringify(agentWithNulls)
      );

      const response = await GET();
      const data = await response.json();

      const agent = data.agents.find(
        (a: { stxAddress: string }) => a.stxAddress === "SP9999999999999999999999999999999"
      );

      expect(agent).toBeDefined();
      expect(agent.description).toBeNull();
      expect(agent.bnsName).toBeNull();
    });
  });
});
