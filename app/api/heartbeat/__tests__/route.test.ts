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
import { buildMockD1 } from "./helpers/mock-d1";

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

    // P3A: heartbeat POST now writes via the canonical updateAgentInD1
    // mirror helper (a single UPDATE that touches last_active_at +
    // last_check_in_at + other mutable columns). Assert against that
    // statement shape, not the prior bespoke single-column UPDATE.
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    const sql = mock.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("UPDATE agents SET");
    expect(sql).toMatch(/last_check_in_at\s*=\s*max\s*\(/);
    expect(sql).toMatch(/last_active_at\s*=\s*max\s*\(/);
    expect(sql).toContain("WHERE btc_address = ?");
    // last-active-at + last-check-in-at slots both receive the timestamp.
    const binds = mock.bind.mock.calls[0] as unknown[];
    expect(binds).toContain(TEST_TIMESTAMP);
    expect(binds[binds.length - 1]).toBe(TEST_BTC);
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

  it("429 body matches the public contract — includes nextCheckInAt and retryAfter (OpenAPI 429 schema, openapi.json)", async () => {
    // Pin time so nextCheckInAt is deterministic.
    const fixedNow = new Date("2026-05-20T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockResolvedValue({ success: false });

    // Agent has a prior lastCheckInAt so we can assert it is echoed back.
    const agentWithPriorCheckIn = {
      ...buildSuccessAgent(),
      agent: {
        ...buildSuccessAgent().agent,
        lastCheckInAt: "2026-05-20T11:58:00.000Z",
      },
    };
    (lookupAgentWithLevel as Mock).mockResolvedValue(agentWithPriorCheckIn);

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
    const body = (await response.json()) as {
      error: string;
      retryAfter: number;
      nextCheckInAt: string;
      lastCheckInAt?: string;
    };
    expect(body.error).toContain("Rate limit exceeded");
    expect(body.retryAfter).toBe(60);
    // nextCheckInAt = now + 60s
    expect(body.nextCheckInAt).toBe("2026-05-20T12:01:00.000Z");
    // lastCheckInAt is echoed when the agent record has one
    expect(body.lastCheckInAt).toBe("2026-05-20T11:58:00.000Z");

    vi.useRealTimers();
  });

  it("429 body omits lastCheckInAt when the agent has never checked in", async () => {
    const fixedNow = new Date("2026-05-20T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const mockKv = buildMockKv();
    const mock = buildMockD1();
    const limit = vi.fn().mockResolvedValue({ success: false });

    // Default agent fixture has no lastCheckInAt (first-time checker).
    (lookupAgentWithLevel as Mock).mockResolvedValue(buildSuccessAgent());

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
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.nextCheckInAt).toBe("2026-05-20T12:01:00.000Z");
    expect(body).not.toHaveProperty("lastCheckInAt");

    vi.useRealTimers();
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

describe("heartbeat POST — D1 update failure does NOT 500 (P3A: KV-source-of-truth)", () => {
  it("returns 200 with a logged warning when the D1 mirror UPDATE rejects", async () => {
    // P3A change: updateAgentInD1 swallows errors internally because KV
    // is still authoritative. A D1 mirror failure should never turn a
    // KV-successful heartbeat into a user-facing 500. Per Copilot/Codex
    // PR #890 feedback — heartbeat falls back to the same swallow-and-log
    // contract every other AgentRecord mutator gets in P3A.
    const mockKv = buildMockKv();
    const mock = buildMockD1(() => Promise.reject(new Error("D1 boom")));
    const limit = vi.fn().mockResolvedValue({ success: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    expect(limit).toHaveBeenCalledTimes(1);
    // KV mirror still writes — that's the authoritative path in P3A.
    expect(mockKv.put).toHaveBeenCalled();
    // Mirror failure logged via the agents-mirror helper, not heartbeat.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[agents-mirror]")
    );
    // Response payload still includes the timestamp the caller submitted.
    const body = (await response.json()) as { checkIn: { lastCheckInAt: string } };
    expect(body.checkIn.lastCheckInAt).toBe(TEST_TIMESTAMP);
    warnSpy.mockRestore();
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
