/**
 * PR #788 review fix — db threading for STX-capable callers in identity GET.
 *
 * Regression: before the fix, `lookupAgent(kv, address)` in identity/[address]/route.ts
 * did not pass `db`, so SP.../SM.../ST... addresses triggered the fail-closed path
 * and always returned null, causing a 404 for every registered STX agent.
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

vi.mock("@/lib/edge-cache", () => ({
  buildEdgeCacheKey: vi.fn().mockReturnValue("test-cache-key"),
  // Pass-through: invoke loader directly
  withEdgeCache: vi.fn().mockImplementation((_key, _ttl, loader) => loader()),
}));

vi.mock("@/lib/identity/kv-cache", () => ({
  getCachedIdentity: vi.fn().mockResolvedValue({ hit: false }),
  setCachedIdentity: vi.fn().mockResolvedValue(undefined),
  setCachedIdentityNegative: vi.fn().mockResolvedValue(undefined),
  setCachedIdentityLookupFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/stacks-api-fetch", () => ({
  stacksApiFetch: vi.fn(),
  buildHiroHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/identity/constants", () => ({
  STACKS_API_BASE: "https://api.hiro.so",
  IDENTITY_REGISTRY_CONTRACT: "SP123.identity-registry",
}));

vi.mock("@/lib/logging", () => ({
  createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: vi.fn().mockReturnValue(false),
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- tests ------------------------------------------------------------------

describe("identity/[address] GET — STX address db threading (PR #788)", () => {
  it("(happy path) threads db into lookupAgent for SP... address with cached agentId", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
      ctx: { waitUntil: vi.fn() },
    });

    // Agent has erc8004AgentId already cached in the record
    (lookupAgent as Mock).mockResolvedValue({
      btcAddress: TEST_BTC,
      stxAddress: TEST_STX,
      erc8004AgentId: 42,
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });

    const request = new NextRequest(`http://localhost/api/identity/${TEST_STX}`, {
      headers: { "cf-ray": "test-ray-id" },
    });
    const response = await GET(request, { params: Promise.resolve({ address: TEST_STX }) });

    expect(response.status).toBe(200);
    const body = await response.json() as { agentId: number };
    expect(body.agentId).toBe(42);

    // Critical: db must be passed as 3rd arg to lookupAgent
    expect(lookupAgent).toHaveBeenCalledWith(mockKv, TEST_STX, mockDb);
  });

  it("returns 404 for SP... address not found in D1 (db correctly threaded, lookup returns null)", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
      ctx: { waitUntil: vi.fn() },
    });

    (lookupAgent as Mock).mockResolvedValue(null);

    const request = new NextRequest(`http://localhost/api/identity/${TEST_STX}`, {
      headers: { "cf-ray": "test-ray-id" },
    });
    const response = await GET(request, { params: Promise.resolve({ address: TEST_STX }) });

    expect(response.status).toBe(404);
    expect(lookupAgent).toHaveBeenCalledWith(mockKv, TEST_STX, mockDb);
  });
});
