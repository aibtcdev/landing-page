/**
 * Phase 3.1 PR-A — D1-throws fallback policy regression test.
 *
 * Mirrors the contract established for inbox/outbox in Phase 2.5 (#722):
 * when the D1 read layer throws — transient unavailability, network error,
 * schema mismatch — the GET handler MUST return 503 with a structured body
 * + Retry-After: 5 header, never an unstructured 500.
 *
 * Covers both competition read routes:
 *   - GET /api/competition/status   → getCompetitionStatusFromD1 throw
 *   - GET /api/competition/trades   → listSwapsFromD1 throw
 *
 * See: app/api/inbox/[address]/__tests__/d1-throws-fallback.test.ts (template)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (must be declared before route imports) -------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/competition/d1-reads", () => ({
  getCompetitionStatusFromD1: vi.fn(),
  listSwapsFromD1: vi.fn(),
  countSwapsFromD1: vi.fn(),
  encodeSwapsCursor: vi.fn((t: number, x: string) => `enc(${t},${x})`),
  decodeSwapsCursor: vi.fn(),
}));

// ---- imports after mocks ----------------------------------------------------

import { GET as statusGet } from "../status/route";
import { GET as tradesGet } from "../trades/route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  getCompetitionStatusFromD1,
  listSwapsFromD1,
} from "@/lib/competition/d1-reads";

// ---- shared fixtures --------------------------------------------------------

const TEST_STX = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";

function buildStatusRequest(): NextRequest {
  return new NextRequest(`https://aibtc.com/api/competition/status?address=${TEST_STX}`, {
    method: "GET",
  });
}

function buildTradesRequest(): NextRequest {
  return new NextRequest(`https://aibtc.com/api/competition/trades?address=${TEST_STX}`, {
    method: "GET",
  });
}

function mockRateLimit(allow = true) {
  return {
    limit: vi.fn().mockResolvedValue({ success: allow }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: { prepare: vi.fn() } as unknown as D1Database,
      RATE_LIMIT_READ: mockRateLimit(true),
      LOGS: undefined,
    },
    ctx: { waitUntil: vi.fn() },
  });
});

describe("Phase 3.1 PR-A — D1-throws fallback policy (status)", () => {
  it("returns 503 with structured body when getCompetitionStatusFromD1 throws", async () => {
    (getCompetitionStatusFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await statusGet(buildStatusRequest());

    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      error: "transient_d1_unavailable",
      retry_after: 5,
    });
    expect(body.message).toMatch(/temporarily unavailable/i);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 (not 500) when D1 throws — guards the Forge cutover pattern", async () => {
    (getCompetitionStatusFromD1 as Mock).mockRejectedValue(new Error("D1_ERROR: schema mismatch"));
    const res = await statusGet(buildStatusRequest());
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(503);
  });

  it("returns 503 when the D1 binding is missing entirely", async () => {
    (getCloudflareContext as Mock).mockReturnValue({
      env: { DB: undefined, RATE_LIMIT_READ: mockRateLimit(true), LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await statusGet(buildStatusRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

describe("Phase 3.1 PR-A — D1-throws fallback policy (trades)", () => {
  it("returns 503 with structured body when listSwapsFromD1 throws", async () => {
    (listSwapsFromD1 as Mock).mockRejectedValue(new Error("D1_ERROR: connection reset"));

    const res = await tradesGet(buildTradesRequest());

    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      error: "transient_d1_unavailable",
      retry_after: 5,
    });
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 (not 500) when D1 throws", async () => {
    (listSwapsFromD1 as Mock).mockRejectedValue(new Error("D1_ERROR: anything"));
    const res = await tradesGet(buildTradesRequest());
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(503);
  });

  it("returns 503 when the D1 binding is missing entirely", async () => {
    (getCloudflareContext as Mock).mockReturnValue({
      env: { DB: undefined, RATE_LIMIT_READ: mockRateLimit(true), LOGS: undefined },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await tradesGet(buildTradesRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

// POST /api/competition/trades is exercised in detail by post-verifier.test.ts
// (Phase 3.1 PR-B). The fallback-policy guarantee for that POST is asserted
// there because it has different upstream dependencies (Hiro fetch + D1) than
// the GET path.

describe("Phase 3.1 PR-A — input validation (400)", () => {
  it("status returns 400 on missing address", async () => {
    const res = await statusGet(
      new NextRequest("https://aibtc.com/api/competition/status", { method: "GET" })
    );
    expect(res.status).toBe(400);
  });

  it("status returns 400 on malformed address", async () => {
    const res = await statusGet(
      new NextRequest("https://aibtc.com/api/competition/status?address=not-an-stx", {
        method: "GET",
      })
    );
    expect(res.status).toBe(400);
  });

  it("trades returns 400 on missing address", async () => {
    const res = await tradesGet(
      new NextRequest("https://aibtc.com/api/competition/trades", { method: "GET" })
    );
    expect(res.status).toBe(400);
  });

  it("trades returns 400 when cursor is malformed", async () => {
    const { decodeSwapsCursor } = await import("@/lib/competition/d1-reads");
    (decodeSwapsCursor as Mock).mockImplementation(() => {
      throw new Error("bad cursor");
    });
    const res = await tradesGet(
      new NextRequest(
        `https://aibtc.com/api/competition/trades?address=${TEST_STX}&cursor=garbage`,
        { method: "GET" }
      )
    );
    expect(res.status).toBe(400);
  });
});

describe("Phase 3.1 PR-A — self-doc (?docs=1)", () => {
  it("status returns the doc payload (200) without touching D1", async () => {
    const res = await statusGet(
      new NextRequest("https://aibtc.com/api/competition/status?docs=1", { method: "GET" })
    );
    expect(res.status).toBe(200);
    expect(getCompetitionStatusFromD1).not.toHaveBeenCalled();
    const body = (await res.json()) as any;
    expect(body.endpoint).toBe("/api/competition/status");
  });

  it("trades returns the doc payload (200) without touching D1", async () => {
    const res = await tradesGet(
      new NextRequest("https://aibtc.com/api/competition/trades?docs=1", { method: "GET" })
    );
    expect(res.status).toBe(200);
    expect(listSwapsFromD1).not.toHaveBeenCalled();
    const body = (await res.json()) as any;
    expect(body.endpoint).toBe("/api/competition/trades");
  });
});
