/**
 * Tests for enrichAgentProfile — specifically the optional `prefetchedClaim`
 * parameter introduced in #692 to eliminate the redundant KV read when the
 * agent record comes from a D1 SELECT + LEFT JOIN claims.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichAgentProfile } from "../agent-enrichment";
import {
  countInboxMessagesFromD1,
  countOutboxRepliesFromD1,
} from "../inbox/d1-reads";
import type { AgentRecord, ClaimRecord, ClaimStatus } from "../types";

// ---------------------------------------------------------------------------
// Mock dependencies so enrichAgentProfile does not need real KV / Hiro
// ---------------------------------------------------------------------------

// agent-enrichment.ts imports via the `@/...` alias, so mocks must use the
// same path — relative `../identity` would NOT intercept the actual module
// loaded by enrichAgentProfile (vitest treats them as different modules).
vi.mock("@/lib/identity", () => ({
  detectAgentIdentity: vi.fn().mockResolvedValue(null),
  getReputationSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/heartbeat", () => ({
  getCheckInRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  countInboxMessagesFromD1: vi.fn().mockResolvedValue(0),
  countOutboxRepliesFromD1: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/caip19", () => ({
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
        kv as unknown as KVNamespace,
        undefined
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
        kv as unknown as KVNamespace,
        undefined
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
        kv as unknown as KVNamespace,
        undefined
      );

      expect(result.claim).not.toBeNull();
      expect(result.claim?.status).toBe("rewarded");
    });
  });

  // -------------------------------------------------------------------------
  // Inbox/sent counts post-#730 Step 4 (PR #745) — D1 reads, not KV
  // -------------------------------------------------------------------------
  describe("inbox/sent counts from D1 (post-Step-4)", () => {
    function makeMockDb(): D1Database {
      // enrichAgentProfile only calls countInboxMessagesFromD1 + countOutboxRepliesFromD1,
      // which are vi.mock()ed at the top of the file. The D1Database object
      // itself is opaque to enrichAgentProfile (only passed through), so a
      // sentinel is sufficient.
      return { __mock: true } as unknown as D1Database;
    }

    it("returns zero counts when db is undefined (no stale KV fallback)", async () => {
      const agent = makeAgent();

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        undefined // db undefined → skip D1 reads, return zeros
      );

      expect(result.activity.unreadInboxCount).toBe(0);
      expect(result.activity.sentCount).toBe(0);
      expect(result.activity.hasInboxMessages).toBe(false);
      expect(countInboxMessagesFromD1).not.toHaveBeenCalled();
      expect(countOutboxRepliesFromD1).not.toHaveBeenCalled();
    });

    it("reads inbox unread + total counts from D1 when db is provided", async () => {
      const agent = makeAgent();
      const db = makeMockDb();

      vi.mocked(countInboxMessagesFromD1)
        .mockResolvedValueOnce(7) // total
        .mockResolvedValueOnce(3); // unread
      vi.mocked(countOutboxRepliesFromD1).mockResolvedValueOnce(5);

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        db
      );

      expect(result.activity.unreadInboxCount).toBe(3);
      expect(result.activity.sentCount).toBe(5);
      expect(result.activity.hasInboxMessages).toBe(true);
      expect(countInboxMessagesFromD1).toHaveBeenCalledWith(
        db,
        agent.btcAddress,
        "all"
      );
      expect(countInboxMessagesFromD1).toHaveBeenCalledWith(
        db,
        agent.btcAddress,
        "unread"
      );
      expect(countOutboxRepliesFromD1).toHaveBeenCalledWith(db, agent.btcAddress);
    });

    it("hasInboxMessages=false when D1 returns zero total", async () => {
      const agent = makeAgent();
      const db = makeMockDb();

      vi.mocked(countInboxMessagesFromD1)
        .mockResolvedValueOnce(0) // total
        .mockResolvedValueOnce(0); // unread
      vi.mocked(countOutboxRepliesFromD1).mockResolvedValueOnce(0);

      const result = await enrichAgentProfile(
        agent,
        kv as unknown as KVNamespace,
        db
      );

      expect(result.activity.hasInboxMessages).toBe(false);
      expect(result.activity.unreadInboxCount).toBe(0);
      expect(result.activity.sentCount).toBe(0);
    });
  });
});
