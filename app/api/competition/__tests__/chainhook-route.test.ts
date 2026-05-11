/**
 * Tests for POST /api/competition/chainhook — Phase 3.1 PR-C.
 *
 * Exercises the route's auth + dispatch responsibilities. The
 * verifier's own logic is unit-tested in lib/competition/__tests__.
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
vi.mock("@/lib/competition/verify", () => ({
  verifyAndPersistSwap: vi.fn(),
}));

import { POST } from "../chainhook/route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAndPersistSwap } from "@/lib/competition/verify";
import { computeChainhookSignature } from "@/lib/competition/chainhook";

const SECRET = "test-chainhook-secret";
const TXID = "0x46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";

interface MockEnvOpts {
  omitDb?: boolean;
  omitSecret?: boolean;
}

function mockEnv(opts: MockEnvOpts = {}) {
  const db = opts.omitDb ? undefined : ({ prepare: vi.fn() } as unknown as D1Database);
  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: db,
      LOGS: undefined,
      ...(opts.omitSecret ? {} : { CHAINHOOK_SECRET: SECRET }),
    },
    ctx: { waitUntil: vi.fn() },
  });
}

async function buildSignedRequest(body: unknown): Promise<NextRequest> {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  const sig = await computeChainhookSignature(bodyText, SECRET);
  return new NextRequest("https://aibtc.com/api/competition/chainhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chainhook-signature": sig,
    },
    body: bodyText,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/competition/chainhook — auth gates", () => {
  it("returns 500 when CHAINHOOK_SECRET is not configured", async () => {
    mockEnv({ omitSecret: true });
    const req = new NextRequest("https://aibtc.com/api/competition/chainhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-chainhook-signature": "abc" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns 401 when no signature header is present", async () => {
    mockEnv();
    const req = new NextRequest("https://aibtc.com/api/competition/chainhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature is wrong", async () => {
    mockEnv();
    const req = new NextRequest("https://aibtc.com/api/competition/chainhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chainhook-signature": "0".repeat(64),
      },
      body: JSON.stringify({ apply: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts Authorization: Bearer …", async () => {
    mockEnv();
    const body = JSON.stringify({ apply: [] });
    const sig = await computeChainhookSignature(body, SECRET);
    const req = new NextRequest("https://aibtc.com/api/competition/chainhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sig}`,
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/competition/chainhook — payload + dispatch", () => {
  it("returns 400 on invalid JSON", async () => {
    mockEnv();
    const body = "not-json";
    const sig = await computeChainhookSignature(body, SECRET);
    const req = new NextRequest("https://aibtc.com/api/competition/chainhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-chainhook-signature": sig },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when apply is missing", async () => {
    mockEnv();
    const res = await POST(await buildSignedRequest({ rollback: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when DB binding is missing", async () => {
    mockEnv({ omitDb: true });
    const res = await POST(await buildSignedRequest({ apply: [{ txid: TXID }] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("dispatches each txid to verifyAndPersistSwap with source='chainhook'", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "verified",
      inserted: true,
      row: { txid: TXID } as unknown,
    });
    const res = await POST(await buildSignedRequest({ apply: [{ txid: TXID }] }));
    expect(res.status).toBe(200);
    expect(verifyAndPersistSwap).toHaveBeenCalledTimes(1);
    expect((verifyAndPersistSwap as Mock).mock.calls[0][3]).toBe("chainhook");
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.inserted).toBe(1);
  });

  it("counts already-known vs newly-inserted vs pending vs rejected", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock)
      .mockResolvedValueOnce({ status: "verified", inserted: true, row: {} })
      .mockResolvedValueOnce({ status: "verified", inserted: false, row: {} })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "rejected", code: "sender_not_registered", reason: "x" });
    const apply = [
      { txid: "0x" + "a".repeat(64) },
      { txid: "0x" + "b".repeat(64) },
      { txid: "0x" + "c".repeat(64) },
      { txid: "0x" + "d".repeat(64) },
    ];
    const res = await POST(await buildSignedRequest({ apply }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 4,
      inserted: 1,
      alreadyKnown: 1,
      pending: 1,
      rejected: 1,
    });
  });

  it("returns 200 with processed:0 on an empty apply batch (no spurious 4xx)", async () => {
    mockEnv();
    const res = await POST(await buildSignedRequest({ apply: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(verifyAndPersistSwap).not.toHaveBeenCalled();
  });
});
