/**
 * Tests for GET/POST /api/admin/competition/finalize.
 *
 * Covers:
 *   - Auth denial: missing or wrong X-Admin-Key → 401
 *   - GET self-doc: returns endpoint metadata + rounds list
 *   - POST action "close": status-machine enforcement + grace-period check
 *   - POST action "snapshot": tokenIds validation + status check + dry-run isolation
 *   - POST action "finalize": status check + dry-run isolation + happy path
 *
 * Mock pattern mirrors app/api/admin/backfill/__tests__/route.test.ts:
 *   vi.mock("@opennextjs/cloudflare"), vi.mock("@/lib/logging"), vi.mock kv-cache.
 *   Auth: supply ARC_ADMIN_API_KEY: "test-admin-key" so HMAC("test-admin-key")
 *   matches the X-Admin-Key header value.
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 3.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  isLogsRPC: vi.fn(() => false),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(),
}));

// Mock getCachedTokenPrices so snapshot dry-run tests control the KV output.
vi.mock("@/lib/external/tenero/kv-cache", () => ({
  getCachedTokenPrices: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCachedTokenPrices } from "@/lib/external/tenero/kv-cache";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUND_ID = "week-1-2026-05-13";

const OPEN_ROUND = {
  round_id: ROUND_ID,
  starts_at: 1778700600,
  ends_at: 1779305400,
  grace_ends_at: 1, // 1970 — always in the past → grace has elapsed
  status: "open",
  min_volume_usd: 50.0,
  min_priced_trade_count: 3,
  created_at: "2026-05-13T19:30:00Z",
  finalized_at: null,
};

const CLOSED_ROUND = { ...OPEN_ROUND, grace_ends_at: 1, status: "closed" };
const FINALIZING_ROUND = { ...OPEN_ROUND, grace_ends_at: 1, status: "finalizing" };
const FINALIZED_ROUND = { ...OPEN_ROUND, grace_ends_at: 1, status: "finalized" };

const PRICE_SNAPSHOT_ROWS = [
  { token_id: "SP111.wstx", price_usd: 0.25, decimals: 6 },
  { token_id: "SP222.ststx", price_usd: 0.28, decimals: 6 },
];

// A minimal swap row so computeRoundResults returns at least one result
const SWAP_ROW = {
  sender: "ST1AGENTA",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 5,
  sum_in: 1_000_000_000, // large enough to clear $50 floor
  sum_out: 900_000_000,
  latest_at: 1778900000,
  btc_address: "bc1qagenta",
  erc8004_agent_id: 1,
  source: "agent",
};

// ── D1 mock factory ───────────────────────────────────────────────────────────

/**
 * Stateful mock D1Database routing queries by SQL content.
 * batchCalled tracks whether db.batch() was invoked (for dry-run isolation).
 */
function createD1Mock(opts: {
  roundRow?: object | null;
  existingResultCount?: number;
  swapRows?: object[];
  priceRows?: object[];
  roundsList?: object[];
}): {
  db: D1Database;
  batchCalled: () => boolean;
  runCalled: () => boolean;
} {
  let _batchCalled = false;
  let _runCalled = false;
  const roundRow = opts.roundRow !== undefined ? opts.roundRow : FINALIZING_ROUND;
  const existingResultCount = opts.existingResultCount ?? 0;
  const swapRows = opts.swapRows ?? [SWAP_ROW];
  const priceRows = opts.priceRows ?? PRICE_SNAPSHOT_ROWS;
  const roundsList = opts.roundsList ?? [OPEN_ROUND];

  const db = {
    prepare: vi.fn((sql: string) => {
      const stmt: {
        _sql: string;
        _binds: unknown[];
        bind: ReturnType<typeof vi.fn>;
        first: ReturnType<typeof vi.fn>;
        all: ReturnType<typeof vi.fn>;
        run: ReturnType<typeof vi.fn>;
      } = {
        _sql: sql,
        _binds: [] as unknown[],
        bind: vi.fn(),
        first: vi.fn(async (): Promise<unknown> => {
          const s = sql.trim().toLowerCase();

          if (s.includes("from competition_rounds") && s.includes("round_id = ?1")) {
            return roundRow;
          }
          if (s.includes("count(*)") && s.includes("competition_round_results")) {
            return { cnt: existingResultCount };
          }
          if (s.includes("select status from competition_rounds")) {
            return roundRow ? { status: (roundRow as { status: string }).status } : null;
          }
          return null;
        }),
        all: vi.fn(async (): Promise<{ results: unknown[] }> => {
          const s = sql.trim().toLowerCase();

          if (s.includes("from competition_round_price_snapshots")) {
            return { results: priceRows };
          }
          if (s.includes("from swaps s")) {
            return { results: swapRows };
          }
          if (s.includes("from competition_rounds order by starts_at")) {
            return { results: roundsList };
          }
          if (s.includes("from competition_rounds")) {
            return { results: roundsList };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          _runCalled = true;
          return { meta: { changes: 1 }, results: [], success: true };
        }),
      };

      stmt.bind.mockImplementation((...args: unknown[]) => {
        stmt._binds = args;
        return stmt;
      });

      return stmt;
    }),
    batch: vi.fn(
      async (stmts: Array<{ _sql: string; _binds: unknown[] }>) => {
        _batchCalled = true;
        return stmts.map(() => ({ meta: { changes: 1 }, results: [], success: true }));
      }
    ),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return {
    db,
    batchCalled: () => _batchCalled,
    runCalled: () => _runCalled,
  };
}

// ── KV mock ───────────────────────────────────────────────────────────────────

function buildKvMock(): KVNamespace {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ── Context mock helper ───────────────────────────────────────────────────────

function mockCtx(db: D1Database, kv?: KVNamespace) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env: {
      ARC_ADMIN_API_KEY: "test-admin-key",
      DB: db,
      VERIFIED_AGENTS: kv ?? buildKvMock(),
    },
    ctx: { waitUntil: vi.fn() },
  });
}

// ── Request builders ──────────────────────────────────────────────────────────

function buildGetRequest(withAuth = true): NextRequest {
  const headers: Record<string, string> = {};
  if (withAuth) headers["X-Admin-Key"] = "test-admin-key";
  return new NextRequest(
    "https://aibtc.com/api/admin/competition/finalize",
    { method: "GET", headers }
  );
}

function buildPostRequest(
  body: unknown,
  dryRun = false,
  withAuth = true,
  wrongKey = false
): NextRequest {
  const url = new URL("https://aibtc.com/api/admin/competition/finalize");
  if (dryRun) url.searchParams.set("dry-run", "true");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (withAuth) {
    headers["X-Admin-Key"] = wrongKey ? "wrong-key" : "test-admin-key";
  }

  return new NextRequest(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Auth denial ───────────────────────────────────────────────────────────────

describe("auth denial", () => {
  it("GET returns 401 without X-Admin-Key", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "secret" },
      ctx: { waitUntil: vi.fn() },
    });
    const resp = await GET(buildGetRequest(false));
    expect(resp.status).toBe(401);
  });

  it("POST returns 401 without X-Admin-Key", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "secret" },
      ctx: { waitUntil: vi.fn() },
    });
    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }, false, false));
    expect(resp.status).toBe(401);
  });

  it("POST returns 401 with wrong X-Admin-Key", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "the-real-secret" },
      ctx: { waitUntil: vi.fn() },
    });
    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }, false, true, true));
    expect(resp.status).toBe(401);
  });
});

// ── GET self-doc ──────────────────────────────────────────────────────────────

describe("GET self-doc", () => {
  it("returns 200 with endpoint description and rounds list", async () => {
    const { db } = createD1Mock({ roundsList: [OPEN_ROUND] });
    mockCtx(db);

    const resp = await GET(buildGetRequest());
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      endpoint: string;
      methods: string[];
      rounds: unknown[];
    };
    expect(body.endpoint).toBe("/api/admin/competition/finalize");
    expect(body.methods).toContain("POST");
    expect(Array.isArray(body.rounds)).toBe(true);
  });

  it("includes all three action descriptions", async () => {
    const { db } = createD1Mock({ roundsList: [] });
    mockCtx(db);

    const resp = await GET(buildGetRequest());
    const body = await resp.json() as { actions: Record<string, string> };
    expect(body.actions.close).toBeTruthy();
    expect(body.actions.snapshot).toBeTruthy();
    expect(body.actions.finalize).toBeTruthy();
  });
});

// ── POST action: close ────────────────────────────────────────────────────────

describe("POST action: close", () => {
  it("returns 404 when round not found", async () => {
    const { db } = createD1Mock({ roundRow: null });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: "no-such-round", action: "close" }));
    expect(resp.status).toBe(404);
  });

  it("returns 409 when round is not in open state (status machine enforcement)", async () => {
    const { db } = createD1Mock({ roundRow: FINALIZING_ROUND });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "close" }));
    expect(resp.status).toBe(409);

    const body = await resp.json() as { error: string; current: string };
    expect(body.error).toContain("wrong_status");
    expect(body.current).toBe("finalizing");
  });

  it("returns 409 when grace period has not elapsed", async () => {
    // grace_ends_at in the far future
    const futureGraceRound = { ...OPEN_ROUND, grace_ends_at: 9_999_999_999 };
    const { db } = createD1Mock({ roundRow: futureGraceRound });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "close" }));
    expect(resp.status).toBe(409);

    const body = await resp.json() as { error: string };
    expect(body.error).toBe("grace_period_active");
  });

  it("dry-run returns wouldUpdate without writing to D1", async () => {
    const { db, runCalled } = createD1Mock({ roundRow: OPEN_ROUND });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "close" }, true));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { dryRun: boolean; wouldUpdate: { status: string } };
    expect(body.dryRun).toBe(true);
    expect(body.wouldUpdate.status).toBe("closed");

    // No write should have occurred
    expect(runCalled()).toBe(false);
  });

  it("happy path: transitions open → closed when grace has elapsed", async () => {
    const { db, runCalled } = createD1Mock({ roundRow: OPEN_ROUND });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "close" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { success: boolean; action: string };
    expect(body.success).toBe(true);
    expect(body.action).toBe("close");

    // D1 run() must have been called (the UPDATE)
    expect(runCalled()).toBe(true);
  });
});

// ── POST action: snapshot ─────────────────────────────────────────────────────

describe("POST action: snapshot", () => {
  it("returns 400 when tokenIds missing from body", async () => {
    const { db } = createD1Mock({ roundRow: CLOSED_ROUND });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({ roundId: ROUND_ID, action: "snapshot", decimalsMap: {} })
    );
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toContain("tokenIds");
  });

  it("returns 400 when tokenIds is empty array", async () => {
    const { db } = createD1Mock({ roundRow: CLOSED_ROUND });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({ roundId: ROUND_ID, action: "snapshot", tokenIds: [], decimalsMap: {} })
    );
    expect(resp.status).toBe(400);
  });

  it("returns 409 when round is not in closed state", async () => {
    const { db } = createD1Mock({ roundRow: OPEN_ROUND });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({
        roundId: ROUND_ID,
        action: "snapshot",
        tokenIds: ["SP111.wstx"],
        decimalsMap: { "SP111.wstx": 6 },
      })
    );
    expect(resp.status).toBe(409);

    const body = await resp.json() as { current: string };
    expect(body.current).toBe("open");
  });

  it("dry-run returns wouldCapture without calling db.batch", async () => {
    const { db, batchCalled } = createD1Mock({ roundRow: CLOSED_ROUND });
    const kv = buildKvMock();
    mockCtx(db, kv);

    // getCachedTokenPrices returns a Map with one priced token
    (getCachedTokenPrices as Mock).mockResolvedValue(
      new Map([["SP111.wstx", { priceUsd: 0.25, fetchedAt: Date.now() }]])
    );

    const resp = await POST(
      buildPostRequest(
        {
          roundId: ROUND_ID,
          action: "snapshot",
          tokenIds: ["SP111.wstx", "SP999.unknown"],
          // Both tokens have decimals declared so the missing-decimals 400
          // doesn't fire; SP999 is unpriced because the KV mock above only
          // has a price for SP111.
          decimalsMap: { "SP111.wstx": 6, "SP999.unknown": 6 },
        },
        true // dry-run
      )
    );
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      dryRun: boolean;
      wouldCapture: { priced: number; unpriced: string[] };
    };
    expect(body.dryRun).toBe(true);
    expect(body.wouldCapture.priced).toBe(1);
    expect(body.wouldCapture.unpriced).toContain("SP999.unknown");

    // db.batch must NOT have been called (no writes)
    expect(batchCalled()).toBe(false);
  });

  it("happy path: calls captureRoundPriceSnapshot and returns result", async () => {
    const { db, batchCalled } = createD1Mock({ roundRow: CLOSED_ROUND });
    const kv = buildKvMock();
    mockCtx(db, kv);

    (getCachedTokenPrices as Mock).mockResolvedValue(
      new Map([["SP111.wstx", { priceUsd: 0.25, fetchedAt: Date.now() }]])
    );

    const resp = await POST(
      buildPostRequest({
        roundId: ROUND_ID,
        action: "snapshot",
        tokenIds: ["SP111.wstx"],
        decimalsMap: { "SP111.wstx": 6 },
      })
    );
    expect(resp.status).toBe(200);

    const body = await resp.json() as { success: boolean; result: { priced: number } };
    expect(body.success).toBe(true);
    expect(typeof body.result.priced).toBe("number");

    // db.batch must have been called (writes the snapshot + status update)
    expect(batchCalled()).toBe(true);
  });

  it("returns 400 when decimalsMap contains non-integer values", async () => {
    const { db, batchCalled } = createD1Mock({ roundRow: CLOSED_ROUND });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({
        roundId: ROUND_ID,
        action: "snapshot",
        tokenIds: ["SP111.wstx", "SP222.ststx"],
        // "abc" coerces to NaN; 6.5 is a non-integer float — both must be rejected.
        decimalsMap: { "SP111.wstx": "abc", "SP222.ststx": 6.5 },
      })
    );
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string; invalidTokens: string[] };
    expect(body.error).toMatch(/non-negative integer/i);
    expect(body.invalidTokens.sort()).toEqual(["SP111.wstx", "SP222.ststx"]);
    expect(batchCalled()).toBe(false);
  });

  it("returns 400 when decimalsMap is missing entries for some tokenIds", async () => {
    const { db, batchCalled } = createD1Mock({ roundRow: CLOSED_ROUND });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({
        roundId: ROUND_ID,
        action: "snapshot",
        tokenIds: ["SP111.wstx", "SP222.ststx"],
        decimalsMap: { "SP111.wstx": 6 }, // missing SP222.ststx
      })
    );
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string; missingTokens: string[] };
    expect(body.error).toMatch(/missing entries/i);
    expect(body.missingTokens).toEqual(["SP222.ststx"]);
    expect(batchCalled()).toBe(false);
  });

  it("dry-run returns 503 empty_price_cache when zero tokens are priced (per #880)", async () => {
    const { db, batchCalled } = createD1Mock({ roundRow: CLOSED_ROUND });
    const kv = buildKvMock();
    mockCtx(db, kv);

    // Simulates production state when Tenero refresh is disabled — KV
    // returns no priced entries. The dry-run should refuse so the operator
    // sees the dependency problem before running the real snapshot.
    (getCachedTokenPrices as Mock).mockResolvedValue(new Map());

    const resp = await POST(
      buildPostRequest(
        {
          roundId: ROUND_ID,
          action: "snapshot",
          tokenIds: ["SP111.wstx"],
          decimalsMap: { "SP111.wstx": 6 },
        },
        true // dry-run
      )
    );
    expect(resp.status).toBe(503);
    const body = await resp.json() as { error: string };
    expect(body.error).toContain("empty_price_cache");
    expect(batchCalled()).toBe(false);
  });
});

// ── POST action: finalize ─────────────────────────────────────────────────────

describe("POST action: finalize", () => {
  it("returns 409 when round is not in finalizing state", async () => {
    const { db } = createD1Mock({ roundRow: CLOSED_ROUND });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }));
    expect(resp.status).toBe(409);

    const body = await resp.json() as { current: string };
    expect(body.current).toBe("closed");
  });

  it("returns 409 on already_finalized error from persistRoundResults", async () => {
    // existingResultCount > 0 triggers the idempotency guard in persistRoundResults
    const { db } = createD1Mock({ roundRow: FINALIZING_ROUND, existingResultCount: 3 });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }));
    expect(resp.status).toBe(409);

    const body = await resp.json() as { error: string };
    expect(body.error).toContain("already_finalized");
  });

  it("dry-run returns computed results without calling db.batch", async () => {
    const { db, batchCalled } = createD1Mock({
      roundRow: FINALIZING_ROUND,
      swapRows: [SWAP_ROW],
      priceRows: PRICE_SNAPSHOT_ROWS,
    });
    mockCtx(db);

    const resp = await POST(
      buildPostRequest({ roundId: ROUND_ID, action: "finalize" }, true)
    );
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      dryRun: boolean;
      computed: {
        resultCount: number;
        rewardCount: number;
        results: unknown[];
        rewards: unknown[];
      };
    };
    expect(body.dryRun).toBe(true);
    expect(typeof body.computed.resultCount).toBe("number");
    expect(Array.isArray(body.computed.results)).toBe(true);
    expect(Array.isArray(body.computed.rewards)).toBe(true);

    // db.batch must NOT have been called (no writes in dry-run)
    expect(batchCalled()).toBe(false);
  });

  it("happy path: calls computeRoundResults + persistRoundResults", async () => {
    const { db, batchCalled } = createD1Mock({
      roundRow: FINALIZING_ROUND,
      swapRows: [SWAP_ROW],
      priceRows: PRICE_SNAPSHOT_ROWS,
    });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      success: boolean;
      resultCount: number;
      rewardCount: number;
    };
    expect(body.success).toBe(true);
    expect(typeof body.resultCount).toBe("number");

    // db.batch must have been called (writes results + rewards + status update)
    expect(batchCalled()).toBe(true);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("input validation", () => {
  it("returns 400 for malformed JSON body", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "test-admin-key", DB: {}, VERIFIED_AGENTS: {} },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest(
      "https://aibtc.com/api/admin/competition/finalize",
      {
        method: "POST",
        headers: { "X-Admin-Key": "test-admin-key", "Content-Type": "application/json" },
        body: "not-json{{{",
      }
    );
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toBe("Malformed JSON body");
  });

  it("returns 400 for missing roundId", async () => {
    const { db } = createD1Mock({});
    mockCtx(db);

    const resp = await POST(buildPostRequest({ action: "finalize" }));
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toContain("roundId");
  });

  it("returns 400 for unknown action", async () => {
    const { db } = createD1Mock({});
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "unknown" }));
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toContain("action");
  });

  it("returns 400 when finalized round gets finalize action (wrong_status path)", async () => {
    const { db } = createD1Mock({ roundRow: FINALIZED_ROUND });
    mockCtx(db);

    const resp = await POST(buildPostRequest({ roundId: ROUND_ID, action: "finalize" }));
    // finalized → finalizing status mismatch → 409
    expect(resp.status).toBe(409);
  });
});
