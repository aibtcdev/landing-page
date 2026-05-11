/**
 * Tests for POST /api/competition/cron — Phase 3.1 PR-D route layer.
 *
 * Exercises the route's auth gate + dispatch into runCompetitionCron.
 * The walk + verifier logic itself is unit-tested in cron.test.ts.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));
vi.mock("@/lib/competition/cron", () => ({
  runCompetitionCron: vi.fn(),
}));

import { POST, GET } from "../cron/route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runCompetitionCron } from "@/lib/competition/cron";

const SECRET = "test-cron-secret";

function mockEnv(opts: { omitDb?: boolean; omitSecret?: boolean } = {}) {
  const db = opts.omitDb ? undefined : ({ prepare: vi.fn() } as unknown as D1Database);
  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: db,
      VERIFIED_AGENTS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as KVNamespace,
      HIRO_API_KEY: undefined,
      LOGS: undefined,
      ...(opts.omitSecret ? {} : { CRON_SECRET: SECRET }),
    },
    ctx: { waitUntil: vi.fn() },
  });
}

function buildRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-cron-secret"] = secret;
  return new NextRequest("https://aibtc.com/api/competition/cron", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/competition/cron — auth", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    mockEnv({ omitSecret: true });
    const res = await POST(buildRequest(SECRET));
    expect(res.status).toBe(500);
  });

  it("returns 401 when X-Cron-Secret is absent", async () => {
    mockEnv();
    const res = await POST(buildRequest(undefined));
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Cron-Secret does not match", async () => {
    mockEnv();
    const res = await POST(buildRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("accepts the request when the secret matches", async () => {
    mockEnv();
    (runCompetitionCron as Mock).mockResolvedValue({
      scanned: 0, found: 0, inserted: 0, alreadyKnown: 0, pending: 0, rejected: 0, cursor: null,
    });
    const res = await POST(buildRequest(SECRET));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/competition/cron — bindings + dispatch", () => {
  it("returns 503 + Retry-After when D1 binding is missing", async () => {
    mockEnv({ omitDb: true });
    const res = await POST(buildRequest(SECRET));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("returns the cron summary on success", async () => {
    mockEnv();
    (runCompetitionCron as Mock).mockResolvedValue({
      scanned: 100,
      found: 5,
      inserted: 3,
      alreadyKnown: 1,
      pending: 1,
      rejected: 0,
      cursor: "SP_NEXT",
    });
    const res = await POST(buildRequest(SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      scanned: 100,
      found: 5,
      inserted: 3,
      alreadyKnown: 1,
      pending: 1,
      rejected: 0,
      cursor: "SP_NEXT",
    });
  });

  it("sets Cache-Control: no-store on every response shape", async () => {
    mockEnv();
    (runCompetitionCron as Mock).mockResolvedValue({
      scanned: 0, found: 0, inserted: 0, alreadyKnown: 0, pending: 0, rejected: 0, cursor: null,
    });
    const res = await POST(buildRequest(SECRET));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/competition/cron — self-doc", () => {
  it("returns the documentation payload without invoking the cron", async () => {
    mockEnv();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(runCompetitionCron).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.endpoint).toBe("/api/competition/cron");
  });
});
