/**
 * Tests for the D1-backed rebuildAgentListCache path (Phase 2.1).
 *
 * Covers:
 *  1. mapRowToCachedAgent — row mapping unit tests (3 level scenarios)
 *  2. Empty D1 result — returns {agents: [], stats: {total:0, ...}}
 *  3. Route-level integration — getCachedAgentList on cold miss uses D1,
 *     asserts zero kv.get calls on the rebuild path (only kv.get(CACHE_KEY)
 *     and kv.get(BUILDING_KEY) are allowed; no btc:, claim:, inbox:agent: reads)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapRowToCachedAgent } from "../agent-list";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal AgentListRow for mapRowToCachedAgent tests.
 * Required fields have sensible defaults; tests override what they need.
 */
function makeRow(
  overrides: Partial<{
    btc_address: string;
    stx_address: string;
    stx_public_key: string;
    btc_public_key: string;
    taproot_address: string | null;
    display_name: string | null;
    description: string | null;
    bns_name: string | null;
    owner: string | null;
    verified_at: string;
    last_active_at: string | null;
    erc8004_agent_id: number | null;
    nostr_public_key: string | null;
    last_identity_check: string | null;
    referred_by_btc: string | null;
    github_username: string | null;
    claim_status: string | null;
    claimed_at: string | null;
    message_count: number;
    unread_count: number;
  }> = {}
) {
  return {
    btc_address: "bc1qagent1",
    stx_address: "SP1AGENT1",
    stx_public_key: "02abc",
    btc_public_key: "03def",
    taproot_address: null,
    display_name: null,
    description: null,
    bns_name: null,
    owner: null,
    verified_at: "2026-01-01T00:00:00.000Z",
    last_active_at: null,
    erc8004_agent_id: null,
    nostr_public_key: null,
    last_identity_check: null,
    referred_by_btc: null,
    github_username: null,
    claim_status: null,
    claimed_at: null,
    message_count: 0,
    unread_count: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapRowToCachedAgent — row mapping unit tests
// ---------------------------------------------------------------------------

describe("mapRowToCachedAgent", () => {
  describe("level computation", () => {
    it("(a) full agent with verified claim → level=2 (Genesis)", () => {
      const row = makeRow({
        claim_status: "verified",
        claimed_at: "2026-02-01T00:00:00.000Z",
        message_count: 5,
        unread_count: 2,
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.level).toBe(2);
      expect(agent.levelName).toBe("Genesis");
    });

    it("(a) full agent with rewarded claim → level=2 (Genesis)", () => {
      const row = makeRow({
        claim_status: "rewarded",
        claimed_at: "2026-02-01T00:00:00.000Z",
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.level).toBe(2);
      expect(agent.levelName).toBe("Genesis");
    });

    it("(b) full agent with no claim (LEFT JOIN miss) → level=1 (Verified Agent)", () => {
      const row = makeRow({
        claim_status: null,
        claimed_at: null,
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.level).toBe(1);
      // Match the actual LEVELS[1].name from lib/levels.ts
      expect(agent.levelName).toBe("Verified Agent");
    });

    it("(c) full agent with claim_status='pending' → level=1 (Verified Agent)", () => {
      const row = makeRow({
        claim_status: "pending",
        claimed_at: "2026-02-01T00:00:00.000Z",
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.level).toBe(1);
      expect(agent.levelName).toBe("Verified Agent");
    });

    it("(c) full agent with claim_status='failed' → level=1 (Verified Agent)", () => {
      const row = makeRow({
        claim_status: "failed",
        claimed_at: "2026-02-01T00:00:00.000Z",
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.level).toBe(1);
      expect(agent.levelName).toBe("Verified Agent");
    });
  });

  describe("field mapping", () => {
    it("maps all snake_case D1 columns to camelCase CachedAgent fields", () => {
      const row = makeRow({
        btc_address: "bc1qtest",
        stx_address: "SP1TEST",
        stx_public_key: "02stxpub",
        btc_public_key: "03btcpub",
        taproot_address: "bc1ptest",
        display_name: "Test Agent",
        description: "A test agent",
        bns_name: "test.btc",
        owner: "testhandle",
        verified_at: "2026-03-01T00:00:00.000Z",
        last_active_at: "2026-03-02T00:00:00.000Z",
        erc8004_agent_id: 42,
        nostr_public_key: "npub1test",
        last_identity_check: "2026-03-03T00:00:00.000Z",
        referred_by_btc: "bc1qreferrer",
        github_username: "testgithub",
        claim_status: null,
        claimed_at: null,
        message_count: 7,
        unread_count: 3,
      });

      const agent = mapRowToCachedAgent(row);

      expect(agent.btcAddress).toBe("bc1qtest");
      expect(agent.stxAddress).toBe("SP1TEST");
      expect(agent.stxPublicKey).toBe("02stxpub");
      expect(agent.btcPublicKey).toBe("03btcpub");
      expect(agent.taprootAddress).toBe("bc1ptest");
      expect(agent.displayName).toBe("Test Agent");
      expect(agent.description).toBe("A test agent");
      expect(agent.bnsName).toBe("test.btc");
      expect(agent.owner).toBe("testhandle");
      expect(agent.verifiedAt).toBe("2026-03-01T00:00:00.000Z");
      expect(agent.lastActiveAt).toBe("2026-03-02T00:00:00.000Z");
      expect(agent.erc8004AgentId).toBe(42);
      expect(agent.nostrPublicKey).toBe("npub1test");
      expect(agent.lastIdentityCheck).toBe("2026-03-03T00:00:00.000Z");
      // referred_by_btc → referredBy (column name deviation from issue sketch)
      expect(agent.referredBy).toBe("bc1qreferrer");
      expect(agent.githubUsername).toBe("testgithub");
      expect(agent.messageCount).toBe(7);
      expect(agent.unreadCount).toBe(3);
    });

    it("passes null fields through as null", () => {
      const row = makeRow(); // all optional fields are null by default

      const agent = mapRowToCachedAgent(row);

      expect(agent.taprootAddress).toBeNull();
      expect(agent.displayName).toBeNull();
      expect(agent.description).toBeNull();
      expect(agent.bnsName).toBeNull();
      expect(agent.owner).toBeNull();
      expect(agent.lastActiveAt).toBeNull();
      expect(agent.erc8004AgentId).toBeNull();
      expect(agent.nostrPublicKey).toBeNull();
      expect(agent.lastIdentityCheck).toBeNull();
      expect(agent.referredBy).toBeNull();
      expect(agent.githubUsername).toBeNull();
    });

    it("message counts come from D1 subquery columns, not KV", () => {
      const row = makeRow({ message_count: 12, unread_count: 4 });

      const agent = mapRowToCachedAgent(row);

      expect(agent.messageCount).toBe(12);
      expect(agent.unreadCount).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// getCachedAgentList — cold miss D1 path with mock D1 + KV
// ---------------------------------------------------------------------------

// Mock getCloudflareContext before importing agent-list so the module picks
// up the mock when rebuildAgentListCache calls it.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Import after mock registration
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCachedAgentList } from "../agent-list";

interface MockKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function mockKV(store: Record<string, string | null> = {}): MockKV {
  const data = new Map<string, string | null>(Object.entries(store));
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

function mockD1(rows: unknown[] = []) {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: rows }),
    }),
  };
}

describe("getCachedAgentList — cold miss uses D1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("empty D1 result → returns {agents: [], stats: {total:0, genesisCount:0, messageCount:0}}", async () => {
    const kv = mockKV({}); // cold miss — no cache
    const db = mockD1([]); // D1 returns no rows

    vi.mocked(getCloudflareContext).mockResolvedValue({
      env: { DB: db },
    } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);

    const result = await getCachedAgentList(kv as unknown as KVNamespace);

    expect(result.agents).toEqual([]);
    expect(result.stats.total).toBe(0);
    expect(result.stats.genesisCount).toBe(0);
    expect(result.stats.messageCount).toBe(0);
  });

  it("cold miss: zero kv.get calls for btc:, claim:, or inbox:agent: prefixes", async () => {
    const kv = mockKV({}); // cold miss

    const rows = [
      makeRow({
        btc_address: "bc1qagent1",
        claim_status: "verified",
        claimed_at: "2026-01-01T00:00:00.000Z",
        message_count: 3,
        unread_count: 1,
      }),
      makeRow({
        btc_address: "bc1qagent2",
        stx_address: "SP2AGENT2",
        claim_status: null,
        claimed_at: null,
        message_count: 0,
        unread_count: 0,
      }),
    ];

    const db = mockD1(rows);

    vi.mocked(getCloudflareContext).mockResolvedValue({
      env: { DB: db },
    } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);

    await getCachedAgentList(kv as unknown as KVNamespace);

    // Confirm kv.get was called, but never with KV data keys
    const kvGetCalls = (kv.get as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => args[0] as string
    );

    const forbiddenPrefixes = ["btc:", "claim:", "inbox:agent:"];
    for (const call of kvGetCalls) {
      for (const prefix of forbiddenPrefixes) {
        expect(call).not.toMatch(new RegExp(`^${prefix}`));
      }
    }
  });

  it("cold miss: D1 is queried once and result is written to KV cache", async () => {
    const kv = mockKV({});
    const db = mockD1([makeRow({ btc_address: "bc1qonly" })]);

    vi.mocked(getCloudflareContext).mockResolvedValue({
      env: { DB: db },
    } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);

    const result = await getCachedAgentList(kv as unknown as KVNamespace);

    // D1 prepare() called exactly once (single query)
    expect(db.prepare).toHaveBeenCalledTimes(1);

    // Result should have 1 agent
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].btcAddress).toBe("bc1qonly");

    // KV put should have been called to cache the snapshot
    expect(kv.put).toHaveBeenCalledWith(
      "cache:agent-list",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 600 })
    );
  });

  it("stats.genesisCount and stats.messageCount are derived from D1 rows", async () => {
    const kv = mockKV({});
    const rows = [
      makeRow({ claim_status: "verified", claimed_at: "2026-01-01T00:00:00.000Z", message_count: 5 }),
      makeRow({ btc_address: "bc1q2", stx_address: "SP2", claim_status: null, message_count: 3 }),
      makeRow({ btc_address: "bc1q3", stx_address: "SP3", claim_status: "pending", claimed_at: "2026-01-01T00:00:00.000Z", message_count: 0 }),
    ];
    const db = mockD1(rows);

    vi.mocked(getCloudflareContext).mockResolvedValue({
      env: { DB: db },
    } as unknown as Awaited<ReturnType<typeof getCloudflareContext>>);

    const result = await getCachedAgentList(kv as unknown as KVNamespace);

    expect(result.stats.total).toBe(3);
    expect(result.stats.genesisCount).toBe(1); // only "verified"
    expect(result.stats.messageCount).toBe(8); // 5+3+0
  });
});
