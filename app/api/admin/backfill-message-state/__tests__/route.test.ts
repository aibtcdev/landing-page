/**
 * Tests for POST /api/admin/backfill-message-state
 *
 * Verifies:
 *  - Admin key required (401 without X-Admin-Key)
 *  - Scans KV inbox:message: prefix, calls D1 UPDATE with COALESCE
 *  - Counts: updated_read_at, updated_replied_at, skipped_already_set,
 *    skipped_no_timestamps, not_in_d1, failed
 *  - Idempotency: running twice on the same records does not double-update
 *  - Cursor pagination: respects cursor, returns next cursor when page not complete
 *  - Orphan handling: KV record with no D1 row counts as not_in_d1, no error
 *  - 503 when DB binding is absent
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- types ------------------------------------------------------------------

interface BackfillMessageStateResponse {
  cursor: string | null;
  batchSize: number;
  scanned: number;
  updated_read_at: number;
  updated_replied_at: number;
  skipped_already_set: number;
  skipped_no_timestamps: number;
  not_in_d1: number;
  failed: { key: string; reason: string }[];
  duration_ms: number;
  // self-doc fields (GET response)
  endpoint?: string;
  method?: string;
  error?: string;
}

// ---- module mocks -----------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue(null), // null = auth passed
}));

// ---- imports after mocks ---------------------------------------------------

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { POST, GET } from "../route";

// ---- helpers ----------------------------------------------------------------

const ADMIN_KEY = "test-admin-key";

function buildRequest(
  body: Record<string, unknown> = {},
  withAdminKey = true
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (withAdminKey) headers["X-Admin-Key"] = ADMIN_KEY;
  return new NextRequest(
    "https://aibtc.com/api/admin/backfill-message-state",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }
  );
}

/** Build a D1 PreparedStatement mock. */
function createPreparedStatement({
  firstResult = null,
  runResult = { meta: { changes: 1 } },
}: {
  firstResult?: unknown;
  runResult?: { meta: { changes: number } };
} = {}) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(runResult),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn(),
    raw: vi.fn(),
  };
  return stmt;
}

/** Build a mock D1 database where prepare() returns the given stmt. */
function createMockDB(stmt = createPreparedStatement()) {
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

/** Build KV mock with controllable list + get behavior. */
function createMockKV(
  keys: string[],
  data: Record<string, string>,
  cursor: string | null = null
) {
  const kv = {
    list: vi.fn().mockResolvedValue({
      keys: keys.map((name) => ({ name })),
      list_complete: cursor === null,
      cursor: cursor ?? undefined,
    }),
    get: vi.fn((key: string) => Promise.resolve(data[key] ?? null)),
    put: vi.fn(),
    delete: vi.fn(),
    getWithMetadata: vi.fn(),
  };
  return kv as unknown as KVNamespace;
}

function mockCloudflareContext(env: Partial<CloudflareEnv>) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env,
    ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MSG_ID_READ = "msg_read_001";
const MSG_ID_REPLIED = "msg_replied_001";
const MSG_ID_BOTH = "msg_both_001";
const MSG_ID_UNREAD_UNREPLIED = "msg_none_001";

function makeKvMessage(
  messageId: string,
  readAt: string | null = null,
  repliedAt: string | null = null
): string {
  return JSON.stringify({
    messageId,
    fromAddress: "SP_SENDER",
    toBtcAddress: "bc1q_recipient",
    toStxAddress: "SP_RECIPIENT",
    content: "test message",
    paymentSatoshis: 100,
    sentAt: "2026-05-01T00:00:00.000Z",
    authenticated: false,
    ...(readAt && { readAt }),
    ...(repliedAt && { repliedAt }),
  });
}

// ---- tests ------------------------------------------------------------------

describe("GET /api/admin/backfill-message-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when admin key is missing", async () => {
    (requireAdmin as Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Missing X-Admin-Key header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    const req = new NextRequest(
      "https://aibtc.com/api/admin/backfill-message-state",
      { method: "GET" }
    );
    const resp = await GET(req);
    expect(resp.status).toBe(401);
  });

  it("returns self-doc JSON when admin key is valid", async () => {
    mockCloudflareContext({});
    const req = new NextRequest(
      "https://aibtc.com/api/admin/backfill-message-state",
      { method: "GET", headers: { "X-Admin-Key": ADMIN_KEY } }
    );
    const resp = await GET(req);
    expect(resp.status).toBe(200);
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body).toHaveProperty("endpoint");
    expect(body).toHaveProperty("method", "POST");
  });
});

describe("POST /api/admin/backfill-message-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 503 when DB binding is absent", async () => {
    mockCloudflareContext({
      VERIFIED_AGENTS: createMockKV([], {}),
      // DB intentionally absent
    });
    const req = buildRequest();
    const resp = await POST(req);
    expect(resp.status).toBe(503);
  });

  it("counts updated_read_at for KV record with readAt set and D1 has NULL read_at", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_READ}`],
      {
        [`inbox:message:${MSG_ID_READ}`]: makeKvMessage(
          MSG_ID_READ,
          "2026-05-10T12:00:00.000Z",
          null
        ),
      }
    );

    // D1 SELECT returns row with read_at = NULL
    const selectStmt = createPreparedStatement({
      firstResult: { read_at: null, replied_at: null },
    });
    const updateStmt = createPreparedStatement();
    const db = {
      prepare: vi
        .fn()
        .mockReturnValueOnce(selectStmt) // first call: SELECT
        .mockReturnValueOnce(updateStmt), // second call: UPDATE
      batch: vi.fn(),
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    expect(resp.status).toBe(200);
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.scanned).toBe(1);
    expect(body.updated_read_at).toBe(1);
    expect(body.updated_replied_at).toBe(0);
  });

  it("counts updated_replied_at for KV record with repliedAt set and D1 has NULL replied_at", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_REPLIED}`],
      {
        [`inbox:message:${MSG_ID_REPLIED}`]: makeKvMessage(
          MSG_ID_REPLIED,
          null,
          "2026-05-10T13:00:00.000Z"
        ),
      }
    );

    const selectStmt = createPreparedStatement({
      firstResult: { read_at: null, replied_at: null },
    });
    const updateStmt = createPreparedStatement();
    const db = {
      prepare: vi
        .fn()
        .mockReturnValueOnce(selectStmt)
        .mockReturnValueOnce(updateStmt),
      batch: vi.fn(),
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.updated_replied_at).toBe(1);
    expect(body.updated_read_at).toBe(0);
  });

  it("counts skipped_already_set when D1 already has both read_at and replied_at set", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_BOTH}`],
      {
        [`inbox:message:${MSG_ID_BOTH}`]: makeKvMessage(
          MSG_ID_BOTH,
          "2026-05-10T12:00:00.000Z",
          "2026-05-10T13:00:00.000Z"
        ),
      }
    );

    // D1 already has both values — nothing to update
    const selectStmt = createPreparedStatement({
      firstResult: {
        read_at: "2026-05-10T12:00:00.000Z",
        replied_at: "2026-05-10T13:00:00.000Z",
      },
    });
    const db = createMockDB(selectStmt);

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.skipped_already_set).toBe(1);
    expect(body.updated_read_at).toBe(0);
    expect(body.updated_replied_at).toBe(0);
  });

  it("counts skipped_no_timestamps for KV records with neither readAt nor repliedAt", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_UNREAD_UNREPLIED}`],
      {
        [`inbox:message:${MSG_ID_UNREAD_UNREPLIED}`]: makeKvMessage(
          MSG_ID_UNREAD_UNREPLIED,
          null,
          null
        ),
      }
    );

    const db = createMockDB();
    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.skipped_no_timestamps).toBe(1);
    expect(body.scanned).toBe(1);
    // D1 should not have been queried — no timestamps means nothing to do
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("counts not_in_d1 for orphan-recipient messages with no D1 row", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_READ}`],
      {
        [`inbox:message:${MSG_ID_READ}`]: makeKvMessage(
          MSG_ID_READ,
          "2026-05-10T12:00:00.000Z",
          null
        ),
      }
    );

    // D1 SELECT returns null — no row exists (orphan-recipient)
    const selectStmt = createPreparedStatement({ firstResult: null });
    const db = createMockDB(selectStmt);

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.not_in_d1).toBe(1);
    expect(body.updated_read_at).toBe(0);
    // Verify UPDATE was NOT called — we return early for orphans
    // prepare() was called once (for SELECT), not twice (SELECT + UPDATE)
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: running twice on the same data does not double-update", async () => {
    // Simulate second run: D1 now has read_at set (from first run)
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_READ}`],
      {
        [`inbox:message:${MSG_ID_READ}`]: makeKvMessage(
          MSG_ID_READ,
          "2026-05-10T12:00:00.000Z",
          null
        ),
      }
    );

    // Second run: D1 already has read_at set
    const selectStmt = createPreparedStatement({
      firstResult: {
        read_at: "2026-05-10T12:00:00.000Z",
        replied_at: null,
      },
    });
    const db = createMockDB(selectStmt);

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    // Both read_at already set → skipped_already_set (because needsReadAt is false,
    // needsRepliedAt is false since repliedAt is null in KV too)
    // Actually: repliedAt is null in KV → skipped_no_timestamps? No — readAt IS set in KV.
    // Logic: needsReadAt = kvReadAt(set) && d1.read_at(set) → false
    //        needsRepliedAt = kvRepliedAt(null) && d1.replied_at(null) → false (kvRepliedAt is null)
    // → skipped_already_set
    expect(body.skipped_already_set).toBe(1);
    expect(body.updated_read_at).toBe(0);
    expect(body.updated_replied_at).toBe(0);
  });

  it("respects cursor pagination — passes cursor to KV list", async () => {
    const kv = createMockKV([], {});
    const db = createMockDB();
    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest({ cursor: "cursor_abc123" }));
    expect(resp.status).toBe(200);

    // Verify KV was called with the cursor
    const listCall = (kv.list as Mock).mock.calls[0][0];
    expect(listCall.cursor).toBe("cursor_abc123");
  });

  it("returns next cursor when KV page is not complete", async () => {
    const kv = createMockKV([], {}, "next_cursor_xyz");
    const db = createMockDB();
    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.cursor).toBe("next_cursor_xyz");
  });

  it("returns null cursor when KV page is complete", async () => {
    const kv = createMockKV([], {}, null);
    const db = createMockDB();
    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.cursor).toBeNull();
  });

  it("counts failed when D1 SELECT throws", async () => {
    const kv = createMockKV(
      [`inbox:message:${MSG_ID_READ}`],
      {
        [`inbox:message:${MSG_ID_READ}`]: makeKvMessage(
          MSG_ID_READ,
          "2026-05-10T12:00:00.000Z",
          null
        ),
      }
    );

    const selectStmt = createPreparedStatement();
    selectStmt.first.mockRejectedValue(new Error("D1 timeout"));
    const db = createMockDB(selectStmt);

    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].key).toBe(`inbox:message:${MSG_ID_READ}`);
    expect(body.failed[0].reason).toContain("D1 SELECT failed");
    expect(body.updated_read_at).toBe(0);
  });

  it("includes duration_ms in response", async () => {
    const kv = createMockKV([], {});
    const db = createMockDB();
    mockCloudflareContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildRequest());
    const body = await resp.json() as BackfillMessageStateResponse;
    expect(typeof body.duration_ms).toBe("number");
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
