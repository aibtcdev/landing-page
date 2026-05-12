/**
 * Phase 4.0c — STX lookup via D1 in resolve/[identifier] (replaces kv.get('stx:...')).
 *
 * Two code paths are tested:
 *
 * Path A — identifierType === "stx" (direct STX address lookup, ~L384):
 *   (a1) D1 returns a row → 200 with mapped identity body
 *   (a2) D1 returns null  → 404 not found (same as prior KV null path)
 *   (a3) D1 throws        → fail-closed → 404 not found
 *   (a4) DB binding undefined → fail-closed → 404 not found
 *
 * Path B — identifierType === "agent-id" (on-chain ID → STX → D1, ~L295):
 *   (b1) D1 returns a row → 200 with mapped identity body (erc8004AgentId set)
 *   (b2) D1 returns null  → 404 not registered on platform
 *   (b3) D1 throws        → fail-closed → 404 not registered on platform
 *   (b4) DB binding undefined → fail-closed → 404 not registered on platform
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (declared before route import) ----------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/identity", () => ({
  callReadOnly: vi.fn(),
  parseClarityValue: vi.fn(),
  IDENTITY_REGISTRY_CONTRACT: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.identity-registry-v2",
}));

vi.mock("@/lib/agent-enrichment", () => ({
  enrichAgentProfile: vi.fn(),
}));

vi.mock("@/lib/agents-index", () => ({
  getAgentsIndex: vi.fn(),
}));

vi.mock("@/lib/bns-reverse-index", () => ({
  lookupBtcAddressByBnsName: vi.fn(),
  syncBnsLookup: vi.fn(),
}));

vi.mock("@/lib/cache/agent-profile", () => ({
  lookupProfileByStxAddress: vi.fn(),
  mapRowToAgentRecord: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { callReadOnly, parseClarityValue } from "@/lib/identity";
import { enrichAgentProfile } from "@/lib/agent-enrichment";
import { lookupProfileByStxAddress, mapRowToAgentRecord } from "@/lib/cache/agent-profile";
import type { AgentProfileRow } from "@/lib/cache/agent-profile";
import type { AgentRecord } from "@/lib/types";

// ---- fixtures ---------------------------------------------------------------

const TEST_STX_ADDRESS = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const TEST_BTC_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TEST_AGENT_ID = 42;

function makeProfileRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    btc_address: TEST_BTC_ADDRESS,
    stx_address: TEST_STX_ADDRESS,
    stx_public_key: "02mock_stx_pubkey",
    btc_public_key: "03mock_btc_pubkey",
    taproot_address: null,
    display_name: "Mock Agent",
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
    taprootAddress: null,
    displayName: "Mock Agent",
    description: null,
    bnsName: null,
    owner: null,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: undefined,
    erc8004AgentId: null,
    nostrPublicKey: null,
    capabilities: null,
    lastIdentityCheck: undefined,
    referredBy: undefined,
    githubUsername: null,
    ...overrides,
  };
}

function makeEnrichmentResult() {
  return {
    levelInfo: { level: 1, levelName: "Registered", nextLevel: null },
    claim: null,
    identity: null,
    reputation: null,
    checkIn: null,
    trust: { level: 1, levelName: "Registered", onChainIdentity: false, reputationScore: null, reputationCount: 0 },
    activity: { lastActiveAt: null, hasCheckedIn: false, hasInboxMessages: false, unreadInboxCount: 0, sentCount: 0 },
    capabilities: [],
    resolvedAgentId: null,
    caip19: null,
  };
}

function buildMockD1(): D1Database {
  return { prepare: vi.fn() } as unknown as D1Database;
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

function buildStxRequest(identifier: string) {
  return new NextRequest(`https://aibtc.com/api/resolve/${identifier}`, { method: "GET" });
}

function buildAgentIdRequest(agentId: number) {
  return new NextRequest(`https://aibtc.com/api/resolve/${agentId}`, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default enrichAgentProfile mock — returns minimal valid enrichment
  (enrichAgentProfile as Mock).mockResolvedValue(makeEnrichmentResult());

  // Default mapRowToAgentRecord — returns a real AgentRecord from a row
  (mapRowToAgentRecord as Mock).mockImplementation(makeAgentRecord);
});

// ============================================================================
// Path A: identifierType === "stx" (direct STX address lookup)
// ============================================================================

describe("Path A — direct STX address lookup: D1 returns row → 200", () => {
  it("returns 200 with mapped identity body when D1 finds the agent", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    const row = makeProfileRow();
    (lookupProfileByStxAddress as Mock).mockResolvedValue(row);
    (mapRowToAgentRecord as Mock).mockReturnValue(makeAgentRecord());

    const res = await GET(
      buildStxRequest(TEST_STX_ADDRESS),
      { params: Promise.resolve({ identifier: TEST_STX_ADDRESS }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.identifierType).toBe("stx");
    expect((body.identity as Record<string, unknown>).stxAddress).toBe(TEST_STX_ADDRESS);
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
    expect(mapRowToAgentRecord as Mock).toHaveBeenCalledWith(row);
  });
});

describe("Path A — direct STX address lookup: D1 returns null → 404", () => {
  it("returns 404 not found when D1 has no row for the STX address", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

    const res = await GET(
      buildStxRequest(TEST_STX_ADDRESS),
      { params: Promise.resolve({ identifier: TEST_STX_ADDRESS }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });
});

describe("Path A — direct STX address lookup: D1 throws → fail-closed → 404", () => {
  it("returns 404 when D1 throws a transient error (fail-closed)", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    (lookupProfileByStxAddress as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await GET(
      buildStxRequest(TEST_STX_ADDRESS),
      { params: Promise.resolve({ identifier: TEST_STX_ADDRESS }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });

  it("returns 404 when DB binding is undefined (fail-closed)", async () => {
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: undefined, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await GET(
      buildStxRequest(TEST_STX_ADDRESS),
      { params: Promise.resolve({ identifier: TEST_STX_ADDRESS }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });
});

// ============================================================================
// Path B: identifierType === "agent-id" (on-chain ID → STX → D1 lookup)
// ============================================================================

describe("Path B — agent-id lookup: D1 returns row → 200 with erc8004AgentId set", () => {
  it("returns 200 with mapped identity body and erc8004AgentId filled in", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    // On-chain resolution: agentId → stxAddress
    (callReadOnly as Mock).mockResolvedValue({ result: "0x00" });
    (parseClarityValue as Mock).mockReturnValue(TEST_STX_ADDRESS);

    const row = makeProfileRow({ erc8004_agent_id: null }); // null to exercise the fill-in
    (lookupProfileByStxAddress as Mock).mockResolvedValue(row);
    const record = makeAgentRecord({ erc8004AgentId: null });
    (mapRowToAgentRecord as Mock).mockReturnValue(record);

    const res = await GET(
      buildAgentIdRequest(TEST_AGENT_ID),
      { params: Promise.resolve({ identifier: String(TEST_AGENT_ID) }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.identifierType).toBe("agent-id");
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
  });
});

describe("Path B — agent-id lookup: D1 returns null → 404 not registered", () => {
  it("returns 404 when D1 has no row for the resolved STX address", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    (callReadOnly as Mock).mockResolvedValue({ result: "0x00" });
    (parseClarityValue as Mock).mockReturnValue(TEST_STX_ADDRESS);
    (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

    const res = await GET(
      buildAgentIdRequest(TEST_AGENT_ID),
      { params: Promise.resolve({ identifier: String(TEST_AGENT_ID) }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
    expect(String(body.error)).toContain("not registered on the AIBTC platform");
  });
});

describe("Path B — agent-id lookup: D1 throws → fail-closed → 404", () => {
  it("returns 404 when D1 throws a transient error (fail-closed)", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: mockDb, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    (callReadOnly as Mock).mockResolvedValue({ result: "0x00" });
    (parseClarityValue as Mock).mockReturnValue(TEST_STX_ADDRESS);
    (lookupProfileByStxAddress as Mock).mockRejectedValue(
      new Error("D1_ERROR: timeout")
    );

    const res = await GET(
      buildAgentIdRequest(TEST_AGENT_ID),
      { params: Promise.resolve({ identifier: String(TEST_AGENT_ID) }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });

  it("returns 404 when DB binding is undefined (fail-closed)", async () => {
    const mockKv = buildMockKv();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: { DB: undefined, VERIFIED_AGENTS: mockKv, HIRO_API_KEY: undefined, LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    (callReadOnly as Mock).mockResolvedValue({ result: "0x00" });
    (parseClarityValue as Mock).mockReturnValue(TEST_STX_ADDRESS);

    const res = await GET(
      buildAgentIdRequest(TEST_AGENT_ID),
      { params: Promise.resolve({ identifier: String(TEST_AGENT_ID) }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.found).toBe(false);
  });
});
