/**
 * PR #788 review fix — db threading for lookupAgentWithLevel in heartbeat GET.
 *
 * Regression: before the fix, `lookupAgentWithLevel(kv, address)` was called
 * without `db`, so STX addresses (SP.../SM.../ST...) triggered the fail-closed
 * path and returned 404 for every STX caller regardless of registration status.
 *
 * After the fix: `db` is extracted from env before the call and passed as the
 * 4th argument, enabling the D1 path for STX addresses.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks -----------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/agent-lookup", () => ({
  lookupAgentWithLevel: vi.fn(),
}));

vi.mock("@/lib/inbox/d1-reads", () => ({
  countInboxMessagesFromD1: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/levels", () => ({
  getAgentLevel: vi.fn().mockReturnValue({ level: 1, levelName: "Registered" }),
  getNextLevel: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/name-generator", () => ({
  generateName: vi.fn().mockReturnValue("MockAgent"),
}));

vi.mock("@/lib/heartbeat", () => ({
  CHECK_IN_MESSAGE_FORMAT: "AIBTC Check-In | {timestamp}",
  buildCheckInMessage: vi.fn().mockReturnValue("AIBTC Check-In | 2026-01-01T00:00:00.000Z"),
  CHECK_IN_RATE_LIMIT_MS: 3600000,
  getCheckInRecord: vi.fn().mockResolvedValue(null),
  updateCheckInRecord: vi.fn().mockResolvedValue({}),
  validateCheckInBody: vi.fn().mockReturnValue({ success: true, data: {} }),
}));

vi.mock("@/lib/news-beats", () => ({
  ACTIVE_BEATS_LIST: "bitcoin,stacks",
}));

vi.mock("@/lib/constants", () => ({
  X_HANDLE: "@aibtcdev",
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
  persistBtcPubkeyIfMissing: vi.fn().mockResolvedValue(undefined),
}));

// ---- imports after mocks ----------------------------------------------------

import { GET, POST } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgentWithLevel } from "@/lib/agent-lookup";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { validateCheckInBody } from "@/lib/heartbeat";

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

function makeSuccessResult() {
  return {
    agent: {
      btcAddress: TEST_BTC,
      stxAddress: TEST_STX,
      btcPublicKey: "03mockpubkey",
      stxPublicKey: "02mockstxpubkey",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: null,
    },
    claim: null,
    level: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- tests ------------------------------------------------------------------

describe("heartbeat GET — STX address db threading (PR #788)", () => {
  it("(happy path) threads db into lookupAgentWithLevel when address is SP...", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
    });

    (lookupAgentWithLevel as Mock).mockResolvedValue(makeSuccessResult());

    const request = new NextRequest(
      `http://localhost/api/heartbeat?address=${TEST_STX}`
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json() as { orientation: { btcAddress: string } };
    expect(body.orientation.btcAddress).toBe(TEST_BTC);

    // Critical assertion: db is passed as 4th arg (minLevel=0 as 3rd)
    expect(lookupAgentWithLevel).toHaveBeenCalledWith(mockKv, TEST_STX, 0, mockDb);
  });

  it("returns 404 for STX address not found (db wired correctly, agent missing in D1)", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
    });

    (lookupAgentWithLevel as Mock).mockResolvedValue({
      error: "Agent not found. Register first.",
      status: 404,
    });

    const request = new NextRequest(
      `http://localhost/api/heartbeat?address=${TEST_STX}`
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
    // db was still passed — this is the correct fail-closed path, not the pre-fix bug
    expect(lookupAgentWithLevel).toHaveBeenCalledWith(mockKv, TEST_STX, 0, mockDb);
  });

  it("returns self-doc JSON when no address param provided (no db needed)", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { VERIFIED_AGENTS: buildMockKv(), DB: buildMockDb() },
    });

    const request = new NextRequest("http://localhost/api/heartbeat");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json() as { endpoint: string };
    expect(body.endpoint).toBe("/api/heartbeat");
    // lookupAgentWithLevel should NOT be called without an address
    expect(lookupAgentWithLevel).not.toHaveBeenCalled();
  });
});

// ---- P4.2: heartbeat POST drops stx: dual-write ------------------------------

describe("heartbeat POST — P4.2 stx: write removed", () => {
  it("writes btc: key but NOT stx: key on successful check-in", async () => {
    const mockKv = buildMockKv();
    const mockDb = buildMockDb();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mockDb,
      },
      ctx: { waitUntil: vi.fn() },
    });

    // validateCheckInBody needs to return signature + timestamp
    (validateCheckInBody as Mock).mockReturnValue({
      success: true,
      data: {
        signature: "mock-signature",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    });

    // verifyBitcoinSignature resolves the BTC address
    (verifyBitcoinSignature as Mock).mockReturnValue({
      valid: true,
      address: TEST_BTC,
      publicKey: undefined,
    });

    // lookupAgentWithLevel returns a registered agent (level 1 minimum required for POST)
    (lookupAgentWithLevel as Mock).mockResolvedValue(makeSuccessResult());

    const request = new NextRequest("http://localhost/api/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        signature: "mock-signature",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    // btc: key MUST be written
    expect(mockKv.put).toHaveBeenCalledWith(
      `btc:${TEST_BTC}`,
      expect.any(String)
    );

    // stx: key MUST NOT be written by heartbeat (P4.2 drop)
    const putCalls = (mockKv.put as Mock).mock.calls;
    const stxPutCall = putCalls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].startsWith("stx:")
    );
    expect(stxPutCall).toBeUndefined();
  });
});
