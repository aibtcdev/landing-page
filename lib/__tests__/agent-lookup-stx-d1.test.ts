/**
 * Phase 4.0d — STX lookup in agent-lookup.ts via D1 (replaces kv.get('stx:...')).
 *
 * Covers eight cases across both functions:
 *  lookupAgent:
 *   (a) D1 returns a row    → AgentRecord returned
 *   (b) D1 returns null     → null returned (not found)
 *   (c) D1 throws           → null returned (fail-closed)
 *   (d) DB binding missing  → null returned (fail-closed)
 *  lookupAgentWithLevel:
 *   (e) D1 returns a row    → success with agent + level
 *   (f) D1 returns null     → notFoundError (404)
 *   (g) D1 throws           → notFoundError (fail-closed)
 *   (h) DB binding missing  → notFoundError (fail-closed)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---- module mocks (declared before tested-module import) --------------------

vi.mock("@/lib/cache/agent-profile", () => ({
  lookupProfileByStxAddress: vi.fn(),
  mapRowToAgentRecord: vi.fn(),
}));

vi.mock("@/lib/levels", () => ({
  computeLevel: vi.fn().mockReturnValue(1),
}));

// ---- imports ----------------------------------------------------------------

import { lookupAgent, lookupAgentWithLevel } from "../agent-lookup";
import {
  lookupProfileByStxAddress,
  mapRowToAgentRecord,
} from "@/lib/cache/agent-profile";
import type { AgentProfileRow } from "@/lib/cache/agent-profile";
import type { AgentRecord } from "@/lib/types";

// ---- fixtures ---------------------------------------------------------------

const TEST_STX_ADDRESS = "SP1TESTADDRESS1234";
const TEST_BTC_ADDRESS = "bc1qtest1address1mock";

function makeProfileRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    btc_address: TEST_BTC_ADDRESS,
    stx_address: TEST_STX_ADDRESS,
    stx_public_key: "02mock_stx_pubkey",
    btc_public_key: "03mock_btc_pubkey",
    taproot_address: null,
    display_name: "MockAgent",
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
    referral_code: "ABCDEF",
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

function makeAgentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    btcAddress: TEST_BTC_ADDRESS,
    stxAddress: TEST_STX_ADDRESS,
    stxPublicKey: "02mock_stx_pubkey",
    btcPublicKey: "03mock_btc_pubkey",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildMockKv(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function buildMockDb(): D1Database {
  return { prepare: vi.fn() } as unknown as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- lookupAgent tests ------------------------------------------------------

describe("lookupAgent: STX address → D1 hit", () => {
  it("(a) returns AgentRecord when D1 returns a profile row", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();
    const row = makeProfileRow();
    const expected = makeAgentRecord();

    (lookupProfileByStxAddress as Mock).mockResolvedValue(row);
    (mapRowToAgentRecord as Mock).mockReturnValue(expected);

    const result = await lookupAgent(mockKv, TEST_STX_ADDRESS, mockDb);

    expect(result).toEqual(expected);
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
    expect(mapRowToAgentRecord as Mock).toHaveBeenCalledWith(row);
    // KV must not be called for the stx branch
    expect(mockKv.get).not.toHaveBeenCalled();
  });
});

describe("lookupAgent: STX address → D1 miss", () => {
  it("(b) returns null when D1 returns null (agent not found)", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

    const result = await lookupAgent(mockKv, TEST_STX_ADDRESS, mockDb);

    expect(result).toBeNull();
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
    expect(mockKv.get).not.toHaveBeenCalled();
  });
});

describe("lookupAgent: STX address → D1 throws (fail-closed)", () => {
  it("(c) returns null when D1 throws a transient error", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (lookupProfileByStxAddress as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const result = await lookupAgent(mockKv, TEST_STX_ADDRESS, mockDb);

    expect(result).toBeNull();
    // KV must not be called as fallback
    expect(mockKv.get).not.toHaveBeenCalled();
  });

  it("(d) returns null when DB binding is undefined (fail-closed)", async () => {
    const mockKv = buildMockKv();

    const result = await lookupAgent(mockKv, TEST_STX_ADDRESS, undefined);

    expect(result).toBeNull();
    expect(lookupProfileByStxAddress as Mock).not.toHaveBeenCalled();
    expect(mockKv.get).not.toHaveBeenCalled();
  });
});

// ---- lookupAgentWithLevel tests ---------------------------------------------

describe("lookupAgentWithLevel: STX address → D1 hit", () => {
  it("(e) returns success with agent + level when D1 returns a profile row", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();
    const row = makeProfileRow();
    const agent = makeAgentRecord();

    (lookupProfileByStxAddress as Mock).mockResolvedValue(row);
    (mapRowToAgentRecord as Mock).mockReturnValue(agent);
    // computeLevel is mocked to return 1

    const result = await lookupAgentWithLevel(mockKv, TEST_STX_ADDRESS, 0, mockDb);

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.agent).toEqual(agent);
      expect(result.level).toBe(1);
    }
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
  });
});

describe("lookupAgentWithLevel: STX address → D1 miss (fail-closed)", () => {
  it("(f) returns 404 not-found error when D1 returns null", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

    const result = await lookupAgentWithLevel(mockKv, TEST_STX_ADDRESS, 0, mockDb);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(404);
      expect(result.error).toMatch(/not found/i);
    }
  });
});

describe("lookupAgentWithLevel: STX address → D1 throws (fail-closed)", () => {
  it("(g) returns 404 not-found when D1 throws a transient error", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (lookupProfileByStxAddress as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const result = await lookupAgentWithLevel(mockKv, TEST_STX_ADDRESS, 0, mockDb);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(404);
    }
    // KV must not be called as fallback
    expect(mockKv.get).not.toHaveBeenCalled();
  });

  it("(h) returns 404 not-found when DB binding is undefined (fail-closed)", async () => {
    const mockKv = buildMockKv();

    const result = await lookupAgentWithLevel(mockKv, TEST_STX_ADDRESS, 0, undefined);

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(404);
    }
    expect(lookupProfileByStxAddress as Mock).not.toHaveBeenCalled();
    expect(mockKv.get).not.toHaveBeenCalled();
  });
});
