/**
 * PR #788 review fix — db threading for STX-capable callers.
 *
 * Covers vouch/[address] GET: when caller provides an STX address (SP...),
 * `lookupAgent` must receive the D1 binding (db) so the D1 lookup fires
 * instead of fail-closing. Regression: before the fix, `db` was not extracted
 * from env and `lookupAgent(kv, normalizedAddress)` silently returned null for
 * all STX callers.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks -----------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: vi.fn(),
}));

vi.mock("@/lib/vouch", () => ({
  getVouchIndex: vi.fn().mockResolvedValue(null),
  MAX_REFERRALS: 5,
}));

vi.mock("@/lib/name-generator", () => ({
  generateName: vi.fn().mockReturnValue("MockAgent"),
}));

// ---- imports after mocks ----------------------------------------------------

import { GET } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";

// ---- fixtures ---------------------------------------------------------------

const TEST_STX = "SP1TESTADDRESSABCDEF";
const TEST_BTC = "bc1qtest1mockaddress";

function buildMockKv(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function buildMockDb(): D1Database {
  return { prepare: vi.fn() } as unknown as D1Database;
}

function makeAgentRecord() {
  return {
    btcAddress: TEST_BTC,
    stxAddress: TEST_STX,
    btcPublicKey: "03mockpubkey",
    stxPublicKey: "02mockstxpubkey",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    referredBy: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- tests ------------------------------------------------------------------

describe("vouch/[address] GET — STX address db threading (PR #788)", () => {
  it("(happy path) threads db into lookupAgent when caller provides SP... address", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
    });

    (lookupAgent as Mock).mockResolvedValue(makeAgentRecord());

    const request = new NextRequest(`http://localhost/api/vouch/${TEST_STX}`);
    const response = await GET(request, { params: Promise.resolve({ address: TEST_STX }) });

    expect(response.status).toBe(200);

    // Critical assertion: lookupAgent received the DB binding as 3rd arg
    expect(lookupAgent).toHaveBeenCalledWith(mockKv, TEST_STX, mockDb);
  });

  it("returns 404 when lookupAgent returns null for SP... address (db wired, agent genuinely missing)", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
    });

    (lookupAgent as Mock).mockResolvedValue(null);

    const request = new NextRequest(`http://localhost/api/vouch/${TEST_STX}`);
    const response = await GET(request, { params: Promise.resolve({ address: TEST_STX }) });

    expect(response.status).toBe(404);
    // Confirm db was still passed (fail-closed path, not the pre-fix silent null path)
    expect(lookupAgent).toHaveBeenCalledWith(mockKv, TEST_STX, mockDb);
  });

  it("accepts ST... testnet addresses (ST prefix fix)", async () => {
    const testnetAddr = "ST1TESTADDRESS1234567";
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
    });

    (lookupAgent as Mock).mockResolvedValue({
      ...makeAgentRecord(),
      stxAddress: testnetAddr,
    });

    const request = new NextRequest(`http://localhost/api/vouch/${testnetAddr}`);
    const response = await GET(request, { params: Promise.resolve({ address: testnetAddr }) });

    // ST addresses should now pass the format check (not 400)
    expect(response.status).not.toBe(400);
    expect(lookupAgent).toHaveBeenCalledWith(mockKv, testnetAddr, mockDb);
  });
});
