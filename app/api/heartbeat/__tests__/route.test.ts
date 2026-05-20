/**
 * P2 PR 2 — /api/heartbeat POST tests for the ratelimits-binding + D1 path.
 *
 * Covers the five contract guarantees called out in the P2 plan:
 *
 *   1. POST allowed when RATE_LIMIT_CHECKIN returns success: D1 update runs,
 *      response includes lastCheckInAt matching the request timestamp.
 *   2. POST 429 when binding returns success: false — no D1 write, Retry-After
 *      header set to the canonical 60s window.
 *   3. Fail-open when binding throws — D1 update still runs, response 200.
 *   4. D1 update failure surfaces — response is 500 (no silent failure).
 *   5. Response shape regression — `checkIn.lastCheckInAt` preserved for
 *      consumers that destructure it (was the public shape before this PR).
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

vi.mock("@/lib/inbox/stats", () => ({
  getAgentInboxStats: vi.fn().mockResolvedValue({
    receivedCount: 0,
    unreadCount: 0,
    sentCount: 0,
    lastMessageAt: null,
    lastSentAt: null,
  }),
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
  CHECK_IN_RATE_LIMIT_SECONDS: 60,
  buildCheckInMessage: vi.fn().mockReturnValue("AIBTC Check-In | 2026-01-01T00:00:00.000Z"),
  validateCheckInBody: vi.fn().mockReturnValue({ data: {} }),
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

import { POST } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgentWithLevel } from "@/lib/agent-lookup";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { validateCheckInBody } from "@/lib/heartbeat";

// ---- fixtures ---------------------------------------------------------------

const TEST_BTC = "bc1qtest1mockaddress";
const TEST_STX = "SP1TESTADDRESSABCDEF";
const TEST_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function buildMockKv(): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

interface MockD1 {
  db: D1Database;
  run: Mock;
  bind: Mock;
  prepare: Mock;
}

function buildMockD1(runImpl?: () => Promise<unknown>): MockD1 {
  const run = vi.fn(runImpl ?? (() => Promise.resolve({ success: true })));
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, run, bind, prepare };
}

function buildSuccessAgent() {
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

function buildPostRequest(): NextRequest {
  return new NextRequest("http://localhost/api/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      signature: "mock-signature",
      timestamp: TEST_TIMESTAMP,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

function primeMocks() {
  (validateCheckInBody as Mock).mockReturnValue({
    data: { signature: "mock-signature", timestamp: TEST_TIMESTAMP },
  });
  (verifyBitcoinSignature as Mock).mockReturnValue({
    valid: true,
    address: TEST_BTC,
    publicKey: undefined,
  });
  (lookupAgentWithLevel as Mock).mockResolvedValue(buildSuccessAgent());
}

beforeEach(() => {
  vi.clearAllMocks();
  primeMocks();
});

// ---- tests ------------------------------------------------------------------

describe("heartbeat POST — RATE_LIMIT_CHECKIN binding allows", () => {
  it("returns 200 and writes last_check_in_at to D1 with the request timestamp", async () => {
    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockResolvedValue({ success: true });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mock.db,
        RATE_LIMIT_CHECKIN: { limit } as unknown as RateLimit,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const response = await POST(buildPostRequest());

    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: TEST_BTC });
    expect(mock.prepare).toHaveBeenCalledWith(
      "UPDATE agents SET last_check_in_at = ? WHERE btc_address = ?"
    );
    expect(mock.bind).toHaveBeenCalledWith(TEST_TIMESTAMP, TEST_BTC);
    expect(mock.run).toHaveBeenCalledTimes(1);

    const body = (await response.json()) as {
      checkIn: { lastCheckInAt: string };
    };
    expect(body.checkIn.lastCheckInAt).toBe(TEST_TIMESTAMP);
  });
});

describe("heartbeat POST — RATE_LIMIT_CHECKIN binding denies", () => {
  it("returns 429 with Retry-After header and does NOT write D1 when binding returns success: false", async () => {
    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockResolvedValue({ success: false });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mock.db,
        RATE_LIMIT_CHECKIN: { limit } as unknown as RateLimit,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const response = await POST(buildPostRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mock.run).not.toHaveBeenCalled();
    expect(mockKv.put).not.toHaveBeenCalled();
  });
});

describe("heartbeat POST — fail-open on binding throw", () => {
  it("still writes D1 + returns 200 when RATE_LIMIT_CHECKIN.limit throws (transient platform error)", async () => {
    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockRejectedValue(new Error("ratelimits transient"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mock.db,
        RATE_LIMIT_CHECKIN: { limit } as unknown as RateLimit,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const response = await POST(buildPostRequest());

    expect(response.status).toBe(200);
    expect(mock.run).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "heartbeat.ratelimit_binding_threw",
      expect.objectContaining({ btcAddress: TEST_BTC })
    );
    errorSpy.mockRestore();
  });
});

describe("heartbeat POST — D1 update failure surfaces", () => {
  it("returns 500 when the D1 UPDATE rejects (no silent failure)", async () => {
    const mockKv = buildMockKv();
    const mock = buildMockD1(() => Promise.reject(new Error("D1 boom")));
    const limit = vi.fn().mockResolvedValue({ success: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mock.db,
        RATE_LIMIT_CHECKIN: { limit } as unknown as RateLimit,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const response = await POST(buildPostRequest());

    expect(response.status).toBe(500);
    // Rate-limit binding was already consumed — that's accepted (no rollback).
    expect(limit).toHaveBeenCalledTimes(1);
    // No KV write should have happened — we bailed before the success path.
    expect(mockKv.put).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "heartbeat.d1_update_failed",
      expect.objectContaining({ btcAddress: TEST_BTC })
    );
    errorSpy.mockRestore();
  });
});

describe("heartbeat POST — response shape regression", () => {
  it("preserves the `checkIn.lastCheckInAt` field on success (public response contract)", async () => {
    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockResolvedValue({ success: true });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        VERIFIED_AGENTS: mockKv,
        DB: mock.db,
        RATE_LIMIT_CHECKIN: { limit } as unknown as RateLimit,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const response = await POST(buildPostRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("checkIn");
    const checkIn = body.checkIn as { lastCheckInAt: string };
    expect(checkIn.lastCheckInAt).toBe(TEST_TIMESTAMP);
    // Sibling fields that other consumers depend on
    expect(body).toHaveProperty("level");
    expect(body).toHaveProperty("levelName");
    expect(body).toHaveProperty("orientation");
  });
});
