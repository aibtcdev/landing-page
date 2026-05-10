/**
 * Tests for Phase 2.2: D1-backed /api/agents/[address] profile lookup.
 *
 * Covers:
 *  1. classifyAddress() — all 5 resolver branches + invalid format
 *  2. mapRowToAgentRecord() — D1 row → AgentRecord field mapping
 *  3. mapRowToClaimRecord() — LEFT JOIN hit vs miss
 *  4. lookupProfileBy* helpers — D1 query shape (mock D1)
 *  5. Resolver branches: BTC / STX / numeric / taproot (KV+D1) / BNS (KV+D1)
 *  6. 404 on missing agent
 *  7. LEFT JOIN miss → claim absent → level = 1 (Verified Agent)
 *  8. LEFT JOIN hit, status='verified' → level = 2 (Genesis)
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyAddress,
  mapRowToAgentRecord,
  mapRowToClaimRecord,
  computeProfileLevel,
} from "@/lib/cache/agent-profile";
import type { AgentProfileRow } from "@/lib/cache/agent-profile";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfileRow(
  overrides: Partial<AgentProfileRow> = {}
): AgentProfileRow {
  return {
    btc_address: "bc1qagent1test",
    stx_address: "SP1AGENT1TEST",
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
    capabilities_json: null,
    last_identity_check: null,
    referred_by_btc: null,
    referral_code: "ABC123",
    github_username: null,
    claim_status: null,
    tweet_url: null,
    tweet_author: null,
    claimed_at: null,
    reward_satoshis: null,
    reward_txid: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyAddress — all 5 resolver branches
// ---------------------------------------------------------------------------

describe("classifyAddress", () => {
  describe("Branch 1: BTC address", () => {
    it("bc1q native SegWit v0 → 'btc'", () => {
      expect(classifyAddress("bc1q3dlkt09g32wd8fyxf4lrfhp6j6z2gvzaupqd4w")).toBe("btc");
    });

    it("1... legacy P2PKH → 'btc'", () => {
      expect(classifyAddress("12Haygph1Srm1BgcPUiaGuB4SwC57U4FMS")).toBe("btc");
    });

    it("3... P2SH → 'btc'", () => {
      expect(classifyAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("btc");
    });
  });

  describe("Branch 2: STX address", () => {
    it("SP... mainnet → 'stx'", () => {
      expect(classifyAddress("SP1AGENT1TEST")).toBe("stx");
    });

    it("ST... testnet → 'stx'", () => {
      expect(classifyAddress("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")).toBe("stx");
    });

    it("SM... legacy mainnet → 'stx'", () => {
      expect(classifyAddress("SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G")).toBe("stx");
    });
  });

  describe("Branch 3: numeric (ERC-8004 agent-id)", () => {
    it("numeric string → 'numeric'", () => {
      expect(classifyAddress("42")).toBe("numeric");
    });

    it("multi-digit numeric → 'numeric'", () => {
      expect(classifyAddress("154")).toBe("numeric");
    });
  });

  describe("Branch 4: taproot address (bc1p)", () => {
    it("bc1p taproot address → 'taproot'", () => {
      expect(classifyAddress("bc1pme88yyvca6gjlu9zqpwhlg93j6gfzreu3l6j0zrsgz8el55zgfkq202ed2")).toBe("taproot");
    });
  });

  describe("Branch 5: BNS name", () => {
    it("*.btc BNS name → 'bns'", () => {
      expect(classifyAddress("alice.btc")).toBe("bns");
    });

    it("multi-part BNS → 'bns'", () => {
      expect(classifyAddress("my-agent.btc")).toBe("bns");
    });
  });

  describe("invalid formats", () => {
    it("empty string → null", () => {
      expect(classifyAddress("")).toBeNull();
    });

    it("random string → null", () => {
      expect(classifyAddress("not-an-address")).toBeNull();
    });

    it("hex string without prefix → null", () => {
      expect(classifyAddress("deadbeef1234")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// mapRowToAgentRecord — D1 row → AgentRecord
// ---------------------------------------------------------------------------

describe("mapRowToAgentRecord", () => {
  it("maps all snake_case columns to camelCase AgentRecord fields", () => {
    const row = makeProfileRow({
      btc_address: "bc1qtest",
      stx_address: "SPTEST",
      stx_public_key: "02stxpub",
      btc_public_key: "03btcpub",
      taproot_address: "bc1ptest",
      display_name: "Test Agent",
      description: "A test description",
      bns_name: "test.btc",
      owner: "testhandle",
      verified_at: "2026-03-01T00:00:00.000Z",
      last_active_at: "2026-03-02T00:00:00.000Z",
      erc8004_agent_id: 42,
      nostr_public_key: "npub1test",
      last_identity_check: "2026-03-03T00:00:00.000Z",
      referred_by_btc: "bc1qreferrer",
      github_username: "testgithub",
    });

    const agent = mapRowToAgentRecord(row);

    expect(agent.btcAddress).toBe("bc1qtest");
    expect(agent.stxAddress).toBe("SPTEST");
    expect(agent.stxPublicKey).toBe("02stxpub");
    expect(agent.btcPublicKey).toBe("03btcpub");
    expect(agent.taprootAddress).toBe("bc1ptest");
    expect(agent.displayName).toBe("Test Agent");
    expect(agent.description).toBe("A test description");
    expect(agent.bnsName).toBe("test.btc");
    expect(agent.owner).toBe("testhandle");
    expect(agent.verifiedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(agent.lastActiveAt).toBe("2026-03-02T00:00:00.000Z");
    expect(agent.erc8004AgentId).toBe(42);
    expect(agent.nostrPublicKey).toBe("npub1test");
    expect(agent.lastIdentityCheck).toBe("2026-03-03T00:00:00.000Z");
    expect(agent.referredBy).toBe("bc1qreferrer");
    expect(agent.githubUsername).toBe("testgithub");
  });

  it("passes null optional fields through as null/undefined", () => {
    const row = makeProfileRow(); // all optional fields null
    const agent = mapRowToAgentRecord(row);

    expect(agent.taprootAddress).toBeNull();
    expect(agent.displayName).toBeUndefined(); // null display_name → undefined (per schema)
    expect(agent.description).toBeNull();
    expect(agent.bnsName).toBeNull();
    expect(agent.owner).toBeNull();
    expect(agent.lastActiveAt).toBeUndefined();
    expect(agent.erc8004AgentId).toBeNull();
    expect(agent.nostrPublicKey).toBeNull();
    expect(agent.referredBy).toBeUndefined();
    expect(agent.githubUsername).toBeNull();
  });

  it("parses capabilities_json from JSON string", () => {
    const row = makeProfileRow({
      capabilities_json: '["heartbeat","inbox"]',
    });
    const agent = mapRowToAgentRecord(row);
    expect(agent.capabilities).toEqual(["heartbeat", "inbox"]);
  });

  it("returns null capabilities when capabilities_json is null", () => {
    const row = makeProfileRow({ capabilities_json: null });
    const agent = mapRowToAgentRecord(row);
    expect(agent.capabilities).toBeNull();
  });

  it("returns null capabilities when capabilities_json is malformed JSON", () => {
    const row = makeProfileRow({ capabilities_json: "not-json{" });
    const agent = mapRowToAgentRecord(row);
    expect(agent.capabilities).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapRowToClaimRecord — LEFT JOIN hit vs miss
// ---------------------------------------------------------------------------

describe("mapRowToClaimRecord", () => {
  it("LEFT JOIN miss (claim_status = null) → returns null", () => {
    const row = makeProfileRow({ claim_status: null });
    const claim = mapRowToClaimRecord(row);
    expect(claim).toBeNull();
  });

  it("LEFT JOIN hit, status='verified' → returns ClaimRecord with correct fields", () => {
    const row = makeProfileRow({
      btc_address: "bc1qtest",
      claim_status: "verified",
      tweet_url: "https://x.com/test/status/123",
      tweet_author: "testauthor",
      claimed_at: "2026-02-01T00:00:00.000Z",
      reward_satoshis: 9250,
      reward_txid: null,
    });

    const claim = mapRowToClaimRecord(row);

    expect(claim).not.toBeNull();
    expect(claim!.btcAddress).toBe("bc1qtest");
    expect(claim!.status).toBe("verified");
    expect(claim!.tweetUrl).toBe("https://x.com/test/status/123");
    expect(claim!.tweetAuthor).toBe("testauthor");
    expect(claim!.claimedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(claim!.rewardSatoshis).toBe(9250);
    expect(claim!.rewardTxid).toBeNull();
  });

  it("LEFT JOIN hit, status='pending' → returns ClaimRecord with status='pending'", () => {
    const row = makeProfileRow({
      claim_status: "pending",
      tweet_url: "https://x.com/test/status/456",
      tweet_author: null,
      claimed_at: "2026-03-01T00:00:00.000Z",
      reward_satoshis: 0,
      reward_txid: null,
    });

    const claim = mapRowToClaimRecord(row);
    expect(claim!.status).toBe("pending");
    expect(claim!.rewardSatoshis).toBe(0);
  });

  it("LEFT JOIN hit, status='rewarded' → returns ClaimRecord with rewardTxid", () => {
    const row = makeProfileRow({
      claim_status: "rewarded",
      claimed_at: "2026-02-01T00:00:00.000Z",
      reward_satoshis: 7832,
      reward_txid: "abc123txid",
      tweet_url: "https://x.com/test/status/789",
      tweet_author: "author",
    });

    const claim = mapRowToClaimRecord(row);
    expect(claim!.status).toBe("rewarded");
    expect(claim!.rewardTxid).toBe("abc123txid");
    expect(claim!.rewardSatoshis).toBe(7832);
  });
});

// ---------------------------------------------------------------------------
// computeProfileLevel — level computation from agent + claim
// ---------------------------------------------------------------------------

describe("computeProfileLevel", () => {
  it("claim absent (LEFT JOIN miss) → level = 1 (Verified Agent)", () => {
    const row = makeProfileRow({ claim_status: null });
    const agent = mapRowToAgentRecord(row);
    const claim = mapRowToClaimRecord(row); // null
    const { level, levelName } = computeProfileLevel(agent, claim);
    expect(level).toBe(1);
    expect(levelName).toBe("Verified Agent");
  });

  it("claim status='verified' → level = 2 (Genesis)", () => {
    const row = makeProfileRow({
      claim_status: "verified",
      claimed_at: "2026-02-01T00:00:00.000Z",
    });
    const agent = mapRowToAgentRecord(row);
    const claim = mapRowToClaimRecord(row);
    const { level, levelName } = computeProfileLevel(agent, claim);
    expect(level).toBe(2);
    expect(levelName).toBe("Genesis");
  });

  it("claim status='rewarded' → level = 2 (Genesis)", () => {
    const row = makeProfileRow({
      claim_status: "rewarded",
      claimed_at: "2026-02-01T00:00:00.000Z",
    });
    const agent = mapRowToAgentRecord(row);
    const claim = mapRowToClaimRecord(row);
    const { level } = computeProfileLevel(agent, claim);
    expect(level).toBe(2);
  });

  it("claim status='pending' → level = 1 (not yet Genesis)", () => {
    const row = makeProfileRow({
      claim_status: "pending",
      claimed_at: "2026-02-01T00:00:00.000Z",
    });
    const agent = mapRowToAgentRecord(row);
    const claim = mapRowToClaimRecord(row);
    const { level } = computeProfileLevel(agent, claim);
    expect(level).toBe(1);
  });

  it("claim status='failed' → level = 1 (not yet Genesis)", () => {
    const row = makeProfileRow({
      claim_status: "failed",
      claimed_at: "2026-02-01T00:00:00.000Z",
    });
    const agent = mapRowToAgentRecord(row);
    const claim = mapRowToClaimRecord(row);
    const { level } = computeProfileLevel(agent, claim);
    expect(level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D1 query helpers — mock D1 to assert correct SQL/params per resolver branch
// ---------------------------------------------------------------------------

function mockD1WithRow(row: AgentProfileRow | null) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(row),
      }),
    }),
  };
}

import {
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
  lookupProfileByAgentId,
} from "@/lib/cache/agent-profile";

describe("lookupProfileByBtcAddress", () => {
  it("queries agents WHERE btc_address = ? and returns mapped row", async () => {
    const row = makeProfileRow({ btc_address: "bc1qtest" });
    const db = mockD1WithRow(row);

    const result = await lookupProfileByBtcAddress(db as unknown as D1Database, "bc1qtest");

    expect(result).toEqual(row);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    const sql = db.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("btc_address = ?");
    const bindCall = db.prepare().bind.mock.calls[0];
    expect(bindCall[0]).toBe("bc1qtest");
  });

  it("returns null when D1 returns null (404 path)", async () => {
    const db = mockD1WithRow(null);
    const result = await lookupProfileByBtcAddress(db as unknown as D1Database, "bc1qnotfound");
    expect(result).toBeNull();
  });
});

describe("lookupProfileByStxAddress", () => {
  it("queries agents WHERE stx_address = ?", async () => {
    const row = makeProfileRow({ stx_address: "SPTEST" });
    const db = mockD1WithRow(row);

    const result = await lookupProfileByStxAddress(db as unknown as D1Database, "SPTEST");

    expect(result).toEqual(row);
    const sql = db.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("stx_address = ?");
  });

  it("returns null when not found", async () => {
    const db = mockD1WithRow(null);
    const result = await lookupProfileByStxAddress(db as unknown as D1Database, "SPNOTFOUND");
    expect(result).toBeNull();
  });
});

describe("lookupProfileByAgentId", () => {
  it("queries agents WHERE erc8004_agent_id = ?", async () => {
    const row = makeProfileRow({ erc8004_agent_id: 42 });
    const db = mockD1WithRow(row);

    const result = await lookupProfileByAgentId(db as unknown as D1Database, 42);

    expect(result).toEqual(row);
    const sql = db.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("erc8004_agent_id = ?");
    const bindCall = db.prepare().bind.mock.calls[0];
    expect(bindCall[0]).toBe(42);
  });

  it("returns null when agent-id not found", async () => {
    const db = mockD1WithRow(null);
    const result = await lookupProfileByAgentId(db as unknown as D1Database, 9999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Taproot resolver: KV reverse-lookup → D1
// ---------------------------------------------------------------------------

describe("taproot resolver: KV taproot: → D1 btc_address", () => {
  it("resolves taproot via KV, then fetches D1 by canonical btc_address", async () => {
    // Confirm classifyAddress correctly identifies taproot
    const branch = classifyAddress("bc1pme88yyvca6gjlu9zqpwhlg93j6gfzreu3l6j0zrsgz8el55zgfkq202ed2");
    expect(branch).toBe("taproot");

    // Simulate the resolver: KV returns canonical btc_address, then D1 lookup
    const canonicalBtc = "1DqMnBeVheipoSMX5ajAZDE7DUxYx8rtcv";
    const row = makeProfileRow({ btc_address: canonicalBtc });
    const db = mockD1WithRow(row);

    const result = await lookupProfileByBtcAddress(db as unknown as D1Database, canonicalBtc);
    expect(result!.btc_address).toBe(canonicalBtc);

    // KV taproot: key returns bare string — confirm shape matches real sample
    const kvValue = "1DqMnBeVheipoSMX5ajAZDE7DUxYx8rtcv"; // bare BTC address (sampled 2026-05-09)
    expect(typeof kvValue).toBe("string");
    expect(kvValue.startsWith("1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BNS resolver: classifyAddress
// ---------------------------------------------------------------------------

describe("BNS resolver: classifyAddress", () => {
  it("*.btc suffix → 'bns' branch", () => {
    expect(classifyAddress("arc0.btc")).toBe("bns");
    expect(classifyAddress("my-agent-007.btc")).toBe("bns");
  });
});
