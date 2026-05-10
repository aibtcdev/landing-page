/**
 * Tests for enrichAgentProfile — specifically the optional `prefetchedClaim`
 * parameter introduced in #692 to eliminate the redundant KV read when the
 * agent record comes from a D1 SELECT + LEFT JOIN claims.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichAgentProfile } from "../agent-enrichment";
import type { AgentRecord, ClaimRecord, ClaimStatus } from "../types";

// ---------------------------------------------------------------------------
// Mock dependencies so enrichAgentProfile does not need real KV / Hiro
// ---------------------------------------------------------------------------

// Mock the entire identity module (detectAgentIdentity, getReputationSummary)
vi.mock("../identity", () => ({
  detectAgentIdentity: vi.fn().mockResolvedValue(null),
  getReputationSummary: vi.fn().mockResolvedValue(null),
}));

// Mock heartbeat (getCheckInRecord)
vi.mock("../heartbeat", () => ({
  getCheckInRecord: vi.fn().mockResolvedValue(null),
}));

// Mock inbox helpers
vi.mock("../inbox/kv-helpers", () => ({
  getAgentInbox: vi.fn().mockResolvedValue(null),
  getSentIndex: vi.fn().mockResolvedValue(null),
}));

// Mock CAIP-19
vi.mock("../caip19", () => ({
  getCAIP19AgentId: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeAgent(overrides?: Partial<AgentRecord>): AgentRecord {
  return {
    btcAddress: "bc1qtest",
    stxAddress: "SP1TEST",
    stxPublicKey: "03abc",
    btcPublicKey: "02def",
    verifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaimRecord(
  status: ClaimRecord["status"] = "verified"
): ClaimRecord {
  return {
    btcAddress: "bc1qtest",
    displayName: "Test Agent",
    tweetUrl: "https://x.com/test/status/123",
    tweetAuthor: "testuser",
    claimedAt: new Date().toISOString(),
    rewardSatoshis: 10000,
    rewardTxid: "abc123",
    status,
  };
}

function makeClaimStatus(
  status: ClaimStatus["status"] = "verified"
): ClaimStatus {
  return {
    status,
    claimedAt: new Date().toISOString(),
    rewardSatoshis: 10000,
  };
}

/** Build a minimal KV mock that tracks which keys were read. */
function createMockKv() {
  const store = new Map<string, string>();
  const getCallKeys: string[] = [];
  return {
    get: vi.fn(async (key: string) => {
      getCallKeys.push(key);
      return store.get(key) ?? null;
    }),
    put: vi.fn(async (_key: string, _value: string) => {}),
    delete: vi.fn(async (_key: string) => {}),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: undefined })),
    _store: store,
    _getCallKeys: getCallKeys,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enrichAgentProfile", () => {
  let kv: ReturnType<typeof createMockKv>;

  beforeEach(() => {
    kv = createMockKv();
    vi.clearAllMocks();
  });

  describe("claim passthrough (prefetchedClaim provided)", () => {
    it("skips kv.get('claim:...') when a ClaimRecord is provided", async () => {
      const agent = makeAgent();
      const claim = makeClaimRecord("verified");

      await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        claim
      );

      const claimKvReads = kv._getCallKeys.filter((k) =>
        k.startsWith("claim:")
      );
      expect(claimKvReads).toHaveLength(0);
    });

    it("skips kv.get('claim:...') when null is provided (confirmed no claim)", async () => {
      const agent = makeAgent();

      await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        null // explicit null = caller says "no claim"
      );

      const claimKvReads = kv._getCallKeys.filter((k) =>
        k.startsWith("claim:")
      );
      expect(claimKvReads).toHaveLength(0);
    });

    it("returns the correct claim status when a verified ClaimRecord is provided", async () => {
      const agent = makeAgent();
      const claim = makeClaimRecord("verified");

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        claim
      );

      expect(result.claim).not.toBeNull();
      expect(result.claim?.status).toBe("verified");
    });

    it("returns null claim when null prefetchedClaim is provided", async () => {
      const agent = makeAgent();

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        null
      );

      expect(result.claim).toBeNull();
    });

    it("accepts a ClaimStatus (not just ClaimRecord) as prefetchedClaim", async () => {
      const agent = makeAgent();
      const claimStatus = makeClaimStatus("rewarded");

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        claimStatus
      );

      expect(result.claim).not.toBeNull();
      expect(result.claim?.status).toBe("rewarded");
    });

    it("computes Genesis level (2) when a verified claim is passed through", async () => {
      const agent = makeAgent();
      const claim = makeClaimRecord("verified");

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        claim
      );

      expect(result.levelInfo.level).toBe(2);
      expect(result.levelInfo.levelName).toBe("Genesis");
    });
  });

  describe("existing KV-fetch behavior (prefetchedClaim not provided)", () => {
    it("reads kv.get('claim:...') when prefetchedClaim is omitted", async () => {
      const agent = makeAgent();

      await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace
      );

      const claimKvReads = kv._getCallKeys.filter((k) =>
        k.startsWith("claim:")
      );
      expect(claimKvReads).toHaveLength(1);
      expect(claimKvReads[0]).toBe(`claim:${agent.btcAddress}`);
    });

    it("reads kv.get('claim:...') when prefetchedClaim is explicitly undefined", async () => {
      const agent = makeAgent();

      await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined,
        undefined,
        undefined,
        undefined // explicit undefined = preserve KV path
      );

      const claimKvReads = kv._getCallKeys.filter((k) =>
        k.startsWith("claim:")
      );
      expect(claimKvReads).toHaveLength(1);
    });

    it("returns null claim when kv has no entry (miss)", async () => {
      const agent = makeAgent();

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace
      );

      expect(result.claim).toBeNull();
    });

    it("parses and returns claim from KV when the entry exists", async () => {
      const agent = makeAgent();
      const storedClaim: ClaimStatus = {
        status: "rewarded",
        claimedAt: new Date().toISOString(),
        rewardSatoshis: 10000,
      };
      kv._store.set(`claim:${agent.btcAddress}`, JSON.stringify(storedClaim));

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace
      );

      expect(result.claim).not.toBeNull();
      expect(result.claim?.status).toBe("rewarded");
    });
  });
});
