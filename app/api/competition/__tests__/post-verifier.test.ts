/**
 * Tests for POST /api/competition/trades — Phase 3.1 PR-B route layer.
 *
 * The verifier itself (lib/competition/verify.ts) has its own unit tests
 * with mocked Hiro + D1. Here we exercise the *route's* responsibilities:
 *
 *   - 400 on malformed body / bad txid
 *   - 429 + Retry-After when RATE_LIMIT_MUTATING trips
 *   - 503 + Retry-After when D1 binding is missing
 *   - 202 fallback when verify returns pending (MCP pre-checks confirmation
 *     so this should be unreachable on the happy path; covers Hiro
 *     propagation race only)
 *   - 409 Conflict on idempotent re-submit (the row already exists in D1)
 *     — see secret-mars's PR #738 finding (comment 4418003085)
 *   - 202 + KV write when verify returns pending
 *   - 200 + row when verify returns verified
 *   - 422 on verifier rejections (sender/allowlist/parse)
 *   - 404 on tx_not_found
 *   - 502 on tx_fetch_failed (Retry-After hint)
 *   - 503 on db_unavailable
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- mocks ------------------------------------------------------------------

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

import { POST } from "../trades/route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAndPersistSwap } from "@/lib/competition/verify";

const TXID_RAW = "46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";
const TXID = `0x${TXID_RAW}`;

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("https://aibtc.com/api/competition/trades", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeKv(overrides: Partial<KVNamespace> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as KVNamespace;
}

function mockEnv(
  opts: { allowLimit?: boolean; omitDb?: boolean; kv?: KVNamespace } = {}
) {
  const { allowLimit = true, omitDb = false, kv = makeKv() } = opts;
  const db = omitDb ? undefined : ({ prepare: vi.fn() } as unknown as D1Database);
  (getCloudflareContext as Mock).mockReturnValue({
    env: {
      DB: db,
      VERIFIED_AGENTS: kv,
      RATE_LIMIT_MUTATING: { limit: vi.fn().mockResolvedValue({ success: allowLimit }) },
      LOGS: undefined,
    },
    ctx: { waitUntil: vi.fn() },
  });
  return { kv };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/competition/trades — input validation", () => {
  it("returns 400 on non-JSON body", async () => {
    mockEnv();
    const res = await POST(buildRequest("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing txid", async () => {
    mockEnv();
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed (non-hex) txid", async () => {
    mockEnv();
    const res = await POST(buildRequest({ txid: "not-a-tx" }));
    expect(res.status).toBe(400);
  });

  it("accepts both 0x-prefixed and bare-hex txids and normalizes", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({ status: "pending" });
    const res = await POST(buildRequest({ txid: TXID_RAW }));
    expect(res.status).toBe(202);
    // The handler passed the normalized 0x-prefixed form into verify.
    const passedTxid = (verifyAndPersistSwap as Mock).mock.calls[0][2];
    expect(passedTxid).toBe(TXID);
  });
});

describe("POST /api/competition/trades — rate limit + binding gates", () => {
  it("returns 429 + Retry-After when RATE_LIMIT_MUTATING rejects", async () => {
    mockEnv({ allowLimit: false });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 503 + Retry-After when DB binding is missing", async () => {
    mockEnv({ omitDb: true });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

describe("POST /api/competition/trades — pending fallback (no KV writes)", () => {
  it("returns 202 with note when verify returns pending (Hiro propagation race)", async () => {
    const kv = makeKv();
    mockEnv({ kv });
    (verifyAndPersistSwap as Mock).mockResolvedValue({ status: "pending" });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.note).toMatch(/propagated/i);
  });

  it("does NOT touch KV on any submit (KV pending machinery was removed)", async () => {
    const kv = makeKv();
    mockEnv({ kv });
    (verifyAndPersistSwap as Mock).mockResolvedValue({ status: "pending" });
    await POST(buildRequest({ txid: TXID }));
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
  });
});

describe("POST /api/competition/trades — idempotent re-submit → 409", () => {
  // Regression for secret-mars's PR #738 finding (comment 4418003085).
  // The previous behaviour returned 200 with a byte-identical body on
  // re-submit, leaving callers no way to tell "I wrote this" from
  // "someone wrote this earlier." Re-submits now return 409 with the
  // existing row in the body so callers can reconcile.
  const ROW = {
    txid: TXID,
    sender: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
    contract_id: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
    function_name: "swap-x-for-y",
    token_in: "stx",
    amount_in: 1000000,
    token_out: "ststx",
    amount_out: 859839,
    burn_block_time: 1762547890,
    tx_status: "success",
    source: "cron" as const,
    scored_value: null,
    scored_at: null,
  };

  it("returns 409 + existing_row when inserted:false (row already in D1)", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "verified",
      inserted: false,
      row: ROW,
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "txid_already_verified",
      retryable: false,
    });
    expect(body.existing_row).toEqual(ROW);
  });

  it("includes the row.source in existing_row so callers know which ingestion path won", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "verified",
      inserted: false,
      row: ROW,
    });
    const res = await POST(buildRequest({ txid: TXID }));
    const body = await res.json();
    // ROW.source === "cron" — caller can see cron wrote the row first,
    // not agent-submit. Useful diagnostic.
    expect(body.existing_row.source).toBe("cron");
  });

  it("4-stage lifecycle: pending → pending → verified (200) → re-submit (409)", async () => {
    mockEnv();
    const freshRow = { ...ROW, source: "agent" as const };
    (verifyAndPersistSwap as Mock)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "verified", inserted: true, row: freshRow })
      .mockResolvedValueOnce({ status: "verified", inserted: false, row: freshRow });

    const res1 = await POST(buildRequest({ txid: TXID }));
    expect(res1.status).toBe(202);

    const res2 = await POST(buildRequest({ txid: TXID }));
    expect(res2.status).toBe(202);

    const res3 = await POST(buildRequest({ txid: TXID }));
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3).toEqual(freshRow);
    // 200 body is the row alone — no error / existing_row fields.
    expect(body3.error).toBeUndefined();
    expect(body3.existing_row).toBeUndefined();

    const res4 = await POST(buildRequest({ txid: TXID }));
    expect(res4.status).toBe(409);
    const body4 = await res4.json();
    expect(body4.code).toBe("txid_already_verified");
    expect(body4.existing_row).toEqual(freshRow);

    // Verifier was invoked exactly 4 times — no request-path short-circuit
    // skipped any call.
    expect(verifyAndPersistSwap).toHaveBeenCalledTimes(4);
  });
});

describe("POST /api/competition/trades — verify result → HTTP mapping", () => {
  it("returns 200 with the swap row on verified", async () => {
    mockEnv();
    const row = {
      txid: TXID,
      sender: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      contract_id: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
      function_name: "swap-x-for-y",
      token_in: "stx",
      amount_in: 1000000,
      token_out: "ststx",
      amount_out: 859839,
      burn_block_time: 1762547890,
      tx_status: "success",
      source: "agent",
      scored_value: null,
      scored_at: null,
    };
    (verifyAndPersistSwap as Mock).mockResolvedValue({ status: "verified", inserted: true, row });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(row);
  });

  it("returns 422 on sender_not_registered", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "rejected",
      code: "sender_not_registered",
      reason: "Sender SP… is not in registered_wallets",
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("sender_not_registered");
    expect(body.retryable).toBe(false);
  });

  it("returns 422 on contract_not_allowlisted", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "rejected",
      code: "contract_not_allowlisted",
      reason: "off-allowlist",
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(422);
  });

  it("returns 404 on tx_not_found", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "rejected",
      code: "tx_not_found",
      reason: "Hiro 404",
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(404);
  });

  it("returns 502 + Retry-After on tx_fetch_failed", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "rejected",
      code: "tx_fetch_failed",
      reason: "Hiro 503",
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(502);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = await res.json();
    expect(body.retryable).toBe(true);
  });

  it("returns 503 + Retry-After on db_unavailable", async () => {
    mockEnv();
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "rejected",
      code: "db_unavailable",
      reason: "D1 read failed",
    });
    const res = await POST(buildRequest({ txid: TXID }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});
