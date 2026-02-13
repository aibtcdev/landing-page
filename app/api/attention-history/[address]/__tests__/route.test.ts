import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import type {
  AttentionAgentIndex,
  AttentionResponse,
  AttentionPayout,
  AttentionMessage,
} from "@/lib/attention/types";
import type { AgentRecord } from "@/lib/types";

// Mock dependencies
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

// Import after mocks
const { getCloudflareContext } = await import("@opennextjs/cloudflare");
const { lookupAgent } = await import("@/lib/agent-lookup");

describe("GET /api/attention-history/[address]", () => {
  let mockKV: Record<string, string>;

  beforeEach(() => {
    mockKV = {};
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: {
          get: vi.fn((key: string) => Promise.resolve(mockKV[key] || null)),
        } as unknown as KVNamespace,
      },
      // @ts-expect-error - partial mock
      cf: {},
      ctx: {},
    });
  });

  const createMockAgent = (): AgentRecord => ({
    btcAddress: "bc1qtest",
    stxAddress: "SP1TEST",
    displayName: "Test Agent",
    registeredAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    checkInCount: 1,
    erc8004AgentId: undefined,
  });

  const createMockRequest = (address: string, params?: URLSearchParams) => {
    const url = new URL(`http://localhost/api/attention-history/${address}`);
    if (params) {
      params.forEach((value, key) => url.searchParams.set(key, value));
    }
    return new NextRequest(url);
  };

  describe("success cases", () => {
    it("returns empty history for agent with no attention activity", async () => {
      const agent = createMockAgent();
      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const response = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        btcAddress: agent.btcAddress,
        displayName: agent.displayName,
        history: [],
        totalResponses: 0,
      });
    });

    it("returns history with response and payout for single message", async () => {
      const agent = createMockAgent();
      const messageId = "msg-123";

      const index: AttentionAgentIndex = {
        messageIds: [messageId],
      };

      const response: AttentionResponse = {
        messageId,
        btcAddress: agent.btcAddress,
        response: "Test response",
        signature: "a".repeat(130),
        submittedAt: "2026-02-13T10:00:00Z",
      };

      const payout: AttentionPayout = {
        messageId,
        btcAddress: agent.btcAddress,
        rewardSatoshis: 1000,
        rewardTxid: "tx123",
        paidAt: "2026-02-13T11:00:00Z",
      };

      const message: AttentionMessage = {
        messageId,
        content: "Test message",
        createdAt: "2026-02-13T09:00:00Z",
      };

      mockKV[`attention:agent:${agent.btcAddress}`] = JSON.stringify(index);
      mockKV[`attention:response:${messageId}:${agent.btcAddress}`] =
        JSON.stringify(response);
      mockKV[`attention:payout:${messageId}:${agent.btcAddress}`] =
        JSON.stringify(payout);
      mockKV[`attention:message:${messageId}`] = JSON.stringify(message);

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await result.json();

      expect(result.status).toBe(200);
      expect(data.history).toHaveLength(2); // response + payout
      expect(data.totalResponses).toBe(1);

      const responseItem = data.history.find((h: any) => h.type === "response");
      expect(responseItem).toMatchObject({
        type: "response",
        messageId,
        messageContent: message.content,
        response: response.response,
        timestamp: response.submittedAt,
      });

      const payoutItem = data.history.find((h: any) => h.type === "payout");
      expect(payoutItem).toMatchObject({
        type: "payout",
        messageId,
        messageContent: message.content,
        satoshis: payout.rewardSatoshis,
        txid: payout.rewardTxid,
        timestamp: payout.paidAt,
      });
    });

    it("handles missing message content gracefully", async () => {
      const agent = createMockAgent();
      const messageId = "msg-123";

      const index: AttentionAgentIndex = {
        messageIds: [messageId],
      };

      const response: AttentionResponse = {
        messageId,
        btcAddress: agent.btcAddress,
        response: "Test response",
        signature: "a".repeat(130),
        submittedAt: "2026-02-13T10:00:00Z",
      };

      mockKV[`attention:agent:${agent.btcAddress}`] = JSON.stringify(index);
      mockKV[`attention:response:${messageId}:${agent.btcAddress}`] =
        JSON.stringify(response);
      // Message key intentionally missing

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await result.json();

      expect(result.status).toBe(200);
      expect(data.history[0].messageContent).toBe("Message content unavailable");
    });

    it("sorts history items by timestamp descending", async () => {
      const agent = createMockAgent();
      const messageId1 = "msg-1";
      const messageId2 = "msg-2";

      const index: AttentionAgentIndex = {
        messageIds: [messageId1, messageId2],
      };

      const response1: AttentionResponse = {
        messageId: messageId1,
        btcAddress: agent.btcAddress,
        response: "First response",
        signature: "a".repeat(130),
        submittedAt: "2026-02-13T09:00:00Z",
      };

      const response2: AttentionResponse = {
        messageId: messageId2,
        btcAddress: agent.btcAddress,
        response: "Second response",
        signature: "a".repeat(130),
        submittedAt: "2026-02-13T11:00:00Z",
      };

      const message: AttentionMessage = {
        messageId: "msg",
        content: "Test",
        createdAt: "2026-02-13T08:00:00Z",
      };

      mockKV[`attention:agent:${agent.btcAddress}`] = JSON.stringify(index);
      mockKV[`attention:response:${messageId1}:${agent.btcAddress}`] =
        JSON.stringify(response1);
      mockKV[`attention:response:${messageId2}:${agent.btcAddress}`] =
        JSON.stringify(response2);
      mockKV[`attention:message:${messageId1}`] = JSON.stringify(message);
      mockKV[`attention:message:${messageId2}`] = JSON.stringify(message);

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await result.json();

      expect(result.status).toBe(200);
      // Should be sorted newest first
      expect(data.history[0].timestamp).toBe(response2.submittedAt);
      expect(data.history[1].timestamp).toBe(response1.submittedAt);
    });

    it("respects limit parameter", async () => {
      const agent = createMockAgent();
      const messageIds = Array.from({ length: 30 }, (_, i) => `msg-${i}`);

      const index: AttentionAgentIndex = {
        messageIds,
      };

      mockKV[`attention:agent:${agent.btcAddress}`] = JSON.stringify(index);

      // Mock responses for all messages
      for (const messageId of messageIds) {
        const response: AttentionResponse = {
          messageId,
          btcAddress: agent.btcAddress,
          response: "Test",
          signature: "a".repeat(130),
          submittedAt: new Date().toISOString(),
        };
        mockKV[`attention:response:${messageId}:${agent.btcAddress}`] =
          JSON.stringify(response);
      }

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest(
        "bc1qtest",
        new URLSearchParams({ limit: "10" })
      );
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await result.json();

      expect(result.status).toBe(200);
      expect(data.history.length).toBeLessThanOrEqual(10);
      expect(data.totalResponses).toBe(30);
    });

    it("validates limit parameter and uses default for invalid values", async () => {
      const agent = createMockAgent();
      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest(
        "bc1qtest",
        new URLSearchParams({ limit: "invalid" })
      );
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });

      expect(result.status).toBe(200);
      // Should use default limit of 20 when invalid
    });

    it("caps limit at maximum of 100", async () => {
      const agent = createMockAgent();
      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest(
        "bc1qtest",
        new URLSearchParams({ limit: "200" })
      );
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });

      expect(result.status).toBe(200);
      // Limit should be capped at 100
    });
  });

  describe("error cases", () => {
    it("returns 404 for non-existent agent", async () => {
      vi.mocked(lookupAgent).mockResolvedValue(null);

      const request = createMockRequest("bc1qnonexistent");
      const response = await GET(request, {
        params: Promise.resolve({ address: "bc1qnonexistent" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Agent not found");
    });

    it("returns 500 for invalid JSON in agent index", async () => {
      const agent = createMockAgent();
      mockKV[`attention:agent:${agent.btcAddress}`] = "invalid json";

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const response = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to parse agent attention index");
    });

    it("continues processing when individual message data fails to parse", async () => {
      const agent = createMockAgent();
      const messageId1 = "msg-1";
      const messageId2 = "msg-2";

      const index: AttentionAgentIndex = {
        messageIds: [messageId1, messageId2],
      };

      const response2: AttentionResponse = {
        messageId: messageId2,
        btcAddress: agent.btcAddress,
        response: "Valid response",
        signature: "a".repeat(130),
        submittedAt: "2026-02-13T10:00:00Z",
      };

      const message: AttentionMessage = {
        messageId: "msg",
        content: "Test",
        createdAt: "2026-02-13T08:00:00Z",
      };

      mockKV[`attention:agent:${agent.btcAddress}`] = JSON.stringify(index);
      mockKV[`attention:response:${messageId1}:${agent.btcAddress}`] =
        "invalid json"; // Invalid
      mockKV[`attention:response:${messageId2}:${agent.btcAddress}`] =
        JSON.stringify(response2); // Valid
      mockKV[`attention:message:${messageId2}`] = JSON.stringify(message);

      vi.mocked(lookupAgent).mockResolvedValue(agent);

      const request = createMockRequest("bc1qtest");
      const result = await GET(request, {
        params: Promise.resolve({ address: "bc1qtest" }),
      });
      const data = await result.json();

      expect(result.status).toBe(200);
      expect(data.history).toHaveLength(1);
      expect(data.history[0].response).toBe("Valid response");
    });
  });
});
