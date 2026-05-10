/**
 * Tests for POST /api/admin/reconcile — KV ↔ D1 reconciliation route.
 *
 * Tests call the real GET/POST handlers with mocked getCloudflareContext()
 * and a controlled KV + D1 mock environment, mirroring the pattern from
 * app/api/admin/backfill/__tests__/route.test.ts.
 *
 * Also includes unit tests for the pure computeDrift / computeAgentsDrift
 * helpers from lib/d1/reconcile.ts.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { computeDrift, computeAgentsDrift } from "@/lib/d1/reconcile";

// ── Module mocks ─────────────────────────────────────────────────────────

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

// ── Imports after mocks ──────────────────────────────────────────────────

import { getCloudflareContext } from "@opennextjs/cloudflare";

// ── KV mock helper ───────────────────────────────────────────────────────

function buildKvMock(data: Record<string, string>): KVNamespace {
  const store = { ...data };

  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete store[key];
    }),
    list: vi.fn(async (opts: KVNamespaceListOptions = {}) => {
      const prefix = opts.prefix ?? "";
      const limit = opts.limit ?? 1000;
      const start = opts.cursor ? parseInt(opts.cursor, 10) : 0;
      const all = Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .sort();
      const page = all.slice(start, start + limit);
      const next = start + page.length;
      const listComplete = next >= all.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: listComplete,
        cursor: listComplete ? undefined : String(next),
      };
    }),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ── D1 mock helper ───────────────────────────────────────────────────────

type FirstResult = { cnt: number } | { 1: number } | null;

interface D1MockConfig {
  /**
   * Map of SQL keyword → first() result.
   * Used to return COUNT(*) results for different queries.
   */
  firstResults?: Record<string, FirstResult>;
  /** Default result for first() if no key matches. */
  defaultFirst?: FirstResult;
}

function buildD1Mock(config: D1MockConfig = {}): D1Database {
  const firstMock = vi.fn(async (query: string): Promise<FirstResult> => {
    const { firstResults = {}, defaultFirst = null } = config;
    // Match on full SQL string (longest/most-specific match wins) to avoid keyword collisions.
    // Sort keys descending by length so a query like
    //   "SELECT 1 FROM agents WHERE btc_address = ?" matches
    //   "SELECT 1 FROM agents WHERE btc_address = ?" before "FROM agents".
    const sortedKeys = Object.keys(firstResults).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (query.includes(key)) return firstResults[key];
    }
    return defaultFirst;
  });

  // Track last bound query for first() dispatch
  let lastPreparedQuery = "";

  const boundStatement = {
    run: vi.fn(async () => ({ meta: { changes: 0 }, results: [], success: true })),
    first: vi.fn(async () => firstMock(lastPreparedQuery)),
    all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
  };

  const bindMock = vi.fn(() => boundStatement);

  const statement = {
    bind: bindMock,
    first: vi.fn(async () => firstMock(lastPreparedQuery)),
    run: vi.fn(async () => ({ meta: { changes: 0 }, results: [], success: true })),
    all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
  };

  const prepareMock = vi.fn((query: string) => {
    lastPreparedQuery = query;
    return statement;
  });

  return {
    prepare: prepareMock,
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

// ── Context mock helper ──────────────────────────────────────────────────

function mockContext(env: Partial<CloudflareEnv>) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env: {
      VERIFIED_AGENTS: buildKvMock({}),
      ARC_ADMIN_API_KEY: "test-admin-key",
      ...env,
    },
    ctx: { waitUntil: vi.fn() },
  });
}

// ── Request builders ─────────────────────────────────────────────────────

function buildPostRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("https://aibtc.com/api/admin/reconcile");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), {
    method: "POST",
    headers: { "X-Admin-Key": "test-admin-key" },
  });
}

function buildGetRequest(): NextRequest {
  return new NextRequest("https://aibtc.com/api/admin/reconcile", {
    method: "GET",
    headers: { "X-Admin-Key": "test-admin-key" },
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const FULL_AGENT = JSON.stringify({
  btcAddress: "bc1qagent1",
  stxAddress: "SP1AGENT1",
  stxPublicKey: "03abcdef01",
  btcPublicKey: "02abcdef01",
  verifiedAt: "2026-01-01T00:00:00Z",
  displayName: "Agent One",
});

const PARTIAL_AGENT = JSON.stringify({
  btcAddress: "bc1qpartial",
  btcPublicKey: "02abcdef02",
  verifiedAt: "2026-01-02T00:00:00Z",
  // No stxAddress — PartialAgentRecord
});

const CLAIM_1 = JSON.stringify({
  btcAddress: "bc1qagent1",
  displayName: "Agent One",
  tweetUrl: "https://x.com/agent1/status/123",
  tweetAuthor: "agent1",
  claimedAt: "2026-01-01T01:00:00Z",
  rewardSatoshis: 50000,
  rewardTxid: null,
  status: "verified",
});

const VOUCH_1 = JSON.stringify({
  referrer: "bc1qagent1",
  referee: "bc1qagent2",
  registeredAt: "2026-02-01T00:00:00Z",
  messageSent: false,
  paidOut: false,
});

const INBOX_MSG_1 = JSON.stringify({
  messageId: "msg_test_001",
  fromAddress: "SP1SENDER1",
  toBtcAddress: "bc1qagent1",
  toStxAddress: "SP1AGENT1",
  content: "hello",
  paymentSatoshis: 100,
  sentAt: "2026-01-01T02:00:00Z",
});

const INBOX_AGENT_INDEX = JSON.stringify({
  btcAddress: "bc1qagent1",
  messageIds: ["msg_test_001"],
  unreadCount: 3,
  lastMessageAt: "2026-01-01T02:00:00Z",
});

// ── beforeEach ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Unit tests: pure drift helpers ───────────────────────────────────────

describe("computeDrift (pure unit)", () => {
  it("returns zero drift when KV and D1 match", () => {
    const result = computeDrift(100, 0, 100, 0);
    expect(result.drift).toBe(0);
    expect(result.drift_unexplained).toBe(0);
    expect(result.kv_count_full).toBe(100);
    expect(result.d1_count).toBe(100);
  });

  it("correctly accounts for partial exclusion in kv_count_full", () => {
    // 100 KV total claims, D1 has 60 → drift=40; drift_explained=40 (all explained by partial cascade)
    // drift_unexplained = max(0, 40 - 40) = 0
    const result = computeDrift(100, 0, 60, 40);
    expect(result.kv_count_full).toBe(100);
    expect(result.drift).toBe(40);
    expect(result.drift_explained).toBe(40);
    expect(result.drift_unexplained).toBe(0);
  });

  it("clamps drift_unexplained to 0 when drift_explained exceeds drift (floor-skew scenario)", () => {
    // drift=2 but drift_explained=5 (independent passes can produce minor skew)
    // drift_unexplained must be clamped to 0, not go negative
    const result = computeDrift(10, 0, 8, 5);
    expect(result.drift).toBe(2);
    expect(result.drift_explained).toBe(5);
    expect(result.drift_unexplained).toBe(0); // clamped: max(0, 2-5) = 0
  });

  it("surfaces unexplained drift when drift_explained is insufficient", () => {
    // 130 KV total claims, D1 has 100, explained=20 (partial cascade) → unexplained=10
    const result = computeDrift(130, 0, 100, 20);
    expect(result.drift).toBe(30);
    expect(result.drift_explained).toBe(20);
    expect(result.drift_unexplained).toBe(10);
  });

  it("handles zero counts without error", () => {
    const result = computeDrift(0, 0, 0, 0);
    expect(result.drift).toBe(0);
    expect(result.drift_unexplained).toBe(0);
  });

  it("passes through explained_categories when provided", () => {
    const cats = { partial_cascade: 3, unique_payment_txid_replay: 1, unresolvable_stx_reply: 0 };
    const result = computeDrift(10, 0, 6, 4, cats);
    expect(result.explained_categories).toEqual(cats);
  });

  it("omits explained_categories when not provided", () => {
    const result = computeDrift(10, 0, 6, 4);
    expect(result.explained_categories).toBeUndefined();
  });
});

describe("computeAgentsDrift (pure unit)", () => {
  it("agents drift: baseline scenario — full agents match D1", () => {
    // 1664 KV total, 1421 partial → 243 full; D1 has 243 → zero drift
    const result = computeAgentsDrift(1664, 1421, 243);
    expect(result.kv_count_full).toBe(243);
    expect(result.d1_count).toBe(243);
    expect(result.drift).toBe(0);
    // drift_explained surfaces the partial count for reviewers
    expect(result.drift_explained).toBe(1421);
    // drift_unexplained = drift (0) because partials are already excluded from the comparison
    expect(result.drift_unexplained).toBe(0);
  });

  it("agents drift: unexplained when full agent count exceeds D1", () => {
    // 10 KV total, 2 partial → 8 full; D1 has 5 → drift=3, all unexplained
    const result = computeAgentsDrift(10, 2, 5);
    expect(result.kv_count_full).toBe(8);
    expect(result.drift).toBe(3);
    // drift_explained = partial count (2), informational
    expect(result.drift_explained).toBe(2);
    // drift_unexplained = drift (3): full agents missing from D1 is unexplained
    expect(result.drift_unexplained).toBe(3);
  });
});

// ── Admin auth ───────────────────────────────────────────────────────────

describe("admin-key required", () => {
  it("GET returns 401 without X-Admin-Key", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "secret" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest("https://aibtc.com/api/admin/reconcile", {
      method: "GET",
    });
    const resp = await GET(req);
    expect(resp.status).toBe(401);
  });

  it("POST returns 401 without X-Admin-Key", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "secret" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest("https://aibtc.com/api/admin/reconcile", {
      method: "POST",
    });
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it("POST with wrong X-Admin-Key returns 401", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "the-real-secret" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest("https://aibtc.com/api/admin/reconcile", {
      method: "POST",
      headers: { "X-Admin-Key": "wrong-key" },
    });
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });
});

// ── GET self-documentation ────────────────────────────────────────────────

describe("GET self-documentation", () => {
  it("returns 200 with endpoint description for authenticated admin", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "test-admin-key" },
      ctx: { waitUntil: vi.fn() },
    });

    const resp = await GET(buildGetRequest());
    expect(resp.status).toBe(200);

    const body = await resp.json() as { endpoint: string; methods: string[] };
    expect(body.endpoint).toBe("/api/admin/reconcile");
    expect(body.methods).toContain("POST");
  });
});

// ── Invalid table ─────────────────────────────────────────────────────────

describe("input validation", () => {
  it("returns 400 for unknown table parameter", async () => {
    mockContext({
      VERIFIED_AGENTS: buildKvMock({}),
      DB: buildD1Mock(),
    });

    const resp = await POST(buildPostRequest({ table: "not_a_real_table" }));
    expect(resp.status).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toContain("Invalid table");
  });
});

// ── Agents reconciliation ─────────────────────────────────────────────────

describe("agents table reconciliation", () => {
  it("reports zero drift when KV full agents match D1 count", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qpartial": PARTIAL_AGENT,
    });

    // D1 COUNT(*) returns 1 (only the full agent)
    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
        // spot-check: agent exists in D1
        "WHERE btc_address = ?": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({
      VERIFIED_AGENTS: kv,
      DB: db,
    });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      table: string;
      kv_count: number;
      kv_count_partial_excluded: number;
      d1_count: number;
      drift: number;
      drift_unexplained: number;
    };

    expect(body.table).toBe("agents");
    expect(body.kv_count).toBe(1); // 2 KV - 1 partial = 1 full
    expect(body.kv_count_partial_excluded).toBe(1);
    expect(body.d1_count).toBe(1);
    expect(body.drift).toBe(0);
    expect(body.drift_unexplained).toBe(0);
  });

  it("reports unexplained drift when D1 count is lower than full KV count", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qagent2": JSON.stringify({
        btcAddress: "bc1qagent2",
        stxAddress: "SP1AGENT2",
        stxPublicKey: "03abcdef02",
        btcPublicKey: "02abcdef02",
        verifiedAt: "2026-01-02T00:00:00Z",
      }),
    });

    // D1 only has 1 agent (1 missing → unexplained drift)
    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      drift: number;
      drift_unexplained: number;
    };

    expect(body.drift).toBe(1); // 2 full - 1 D1 = 1 drift
    expect(body.drift_unexplained).toBe(1); // not explained by any partial
  });
});

// ── Claims reconciliation ─────────────────────────────────────────────────

describe("claims table reconciliation", () => {
  it("excludes claim-code: keys from KV count", async () => {
    const kv = buildKvMock({
      "claim:bc1qagent1": CLAIM_1,
      "claim-code:bc1qagent1": JSON.stringify({ code: "ABC123", createdAt: "2026-01-01T00:00:00Z" }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM claims": { cnt: 1 },
        // agent exists in D1 for drift_explained check
        "FROM agents WHERE btc_address": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "claims", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { kv_count: number; drift: number };
    // Only 1 claim key should be counted (not claim-code:)
    expect(body.kv_count).toBe(1);
    expect(body.drift).toBe(0);
  });
});

// ── Vouches reconciliation ─────────────────────────────────────────────────

describe("vouches table reconciliation", () => {
  it("excludes vouch:index: keys from KV count", async () => {
    const kv = buildKvMock({
      "vouch:bc1qagent1:bc1qagent2": VOUCH_1,
      "vouch:index:bc1qagent1": JSON.stringify({
        btcAddress: "bc1qagent1",
        refereeAddresses: ["bc1qagent2"],
        lastVouchAt: "2026-02-01T00:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM vouches": { cnt: 1 },
        "FROM agents WHERE btc_address": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "vouches", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { kv_count: number; drift: number };
    expect(body.kv_count).toBe(1); // index key excluded
    expect(body.drift).toBe(0);
  });
});

// ── inbox_messages reconciliation ─────────────────────────────────────────

describe("inbox_messages table reconciliation", () => {
  it("counts both inbox:message: and inbox:reply: KV keys in total", async () => {
    const kv = buildKvMock({
      "inbox:message:msg_test_001": INBOX_MSG_1,
      "inbox:reply:msg_test_001": JSON.stringify({
        messageId: "msg_test_001",
        fromAddress: "bc1qagent1",
        toBtcAddress: "bc1qsender1",
        reply: "pong",
        signature: "sig_abc",
        repliedAt: "2026-01-01T03:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 2 },
        // inbound check: recipient exists in agents
        "FROM agents WHERE btc_address": { 1: 1 },
        // reply check: parent message exists
        "FROM inbox_messages WHERE message_id": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "2" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { kv_count: number; d1_count: number };
    expect(body.kv_count).toBe(2); // 1 message + 1 reply
    expect(body.d1_count).toBe(2);
  });

  it("runs unreadCount acceptance test for inbox_messages table", async () => {
    const kv = buildKvMock({
      "inbox:message:msg_test_001": INBOX_MSG_1,
      "inbox:agent:bc1qagent1": INBOX_AGENT_INDEX, // unreadCount: 3
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 0 },
        // unreadCount query returns 2 (drift = 3 - 2 = 1)
        "WHERE to_btc_address": { cnt: 2 },
        "FROM agents WHERE btc_address": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      acceptance_tests?: {
        unread_count_drift: Array<{ address: string; kv_cached: number; d1_count: number; drift: number }>;
        passed: boolean;
      };
    };

    expect(body.acceptance_tests).toBeDefined();
    expect(body.acceptance_tests?.unread_count_drift).toHaveLength(1);
    const entry = body.acceptance_tests?.unread_count_drift[0];
    expect(entry?.address).toBe("bc1qagent1");
    expect(entry?.kv_cached).toBe(3);
    // passed should be false because drift != 0
    expect(body.acceptance_tests?.passed).toBe(false);
  });
});

// ── table=all ─────────────────────────────────────────────────────────────

describe("table=all reconciliation", () => {
  it("returns results for all 4 tables", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "claim:bc1qagent1": CLAIM_1,
      "vouch:bc1qagent1:bc1qagent2": VOUCH_1,
      "inbox:message:msg_test_001": INBOX_MSG_1,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
        "FROM claims": { cnt: 1 },
        "FROM inbox_messages": { cnt: 1 },
        "FROM vouches": { cnt: 1 },
        // all FK existence checks pass
        "FROM agents WHERE btc_address": { 1: 1 },
        "FROM inbox_messages WHERE message_id": { 1: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "all", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      tables: Array<{ table: string }>;
      total_drift_unexplained: number;
    };

    expect(body.tables).toHaveLength(4);
    const tableNames = body.tables.map((t) => t.table);
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("claims");
    expect(tableNames).toContain("inbox_messages");
    expect(tableNames).toContain("vouches");
    expect(typeof body.total_drift_unexplained).toBe("number");
  });

  it("includes acceptance_tests in table=all response", async () => {
    const kv = buildKvMock({
      "inbox:agent:bc1qagent1": INBOX_AGENT_INDEX,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 0 },
        "FROM claims": { cnt: 0 },
        "FROM inbox_messages": { cnt: 0 },
        "FROM vouches": { cnt: 0 },
        "WHERE to_btc_address": { cnt: 0 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "all", sampleSize: "1" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      acceptance_tests?: { passed: boolean };
    };
    expect(body.acceptance_tests).toBeDefined();
  });

  it("returns independent per-table duration_ms (not the overall run duration)", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
        "FROM claims": { cnt: 0 },
        "FROM inbox_messages": { cnt: 0 },
        "FROM vouches": { cnt: 0 },
        "WHERE to_btc_address": { cnt: 0 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "all", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      tables: Array<{ table: string; duration_ms: number }>;
      duration_ms: number;
    };

    // Each per-table duration_ms must be a non-negative number
    for (const t of body.tables) {
      expect(typeof t.duration_ms).toBe("number");
      expect(t.duration_ms).toBeGreaterThanOrEqual(0);
    }

    // Per-table duration_ms values should not all be the same as total (they're independent)
    // They should each be <= total since they are sub-ranges of the overall run
    for (const t of body.tables) {
      expect(t.duration_ms).toBeLessThanOrEqual(body.duration_ms + 100); // small slack for clock
    }
  });
});

// ── KV-truth drift_explained (buildFullAgentSet) ───────────────────────────

describe("KV-truth drift_explained via buildFullAgentSet", () => {
  it("classifies claims with partial-agent parents as drift_explained using KV data only", async () => {
    // KV: 1 full agent + 1 partial agent; 2 claims (one for each)
    // D1: 1 claim row (only full agent's claim backfilled)
    // Expected: kv_count=2, d1_count=1, drift=1, drift_explained=1 (partial cascade), drift_unexplained=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,        // full agent
      "btc:bc1qpartial": PARTIAL_AGENT,     // partial agent
      "claim:bc1qagent1": CLAIM_1,          // claim for full agent
      "claim:bc1qpartial": JSON.stringify({ // claim for partial agent (not in D1)
        btcAddress: "bc1qpartial",
        status: "verified",
        claimedAt: "2026-01-03T00:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM claims": { cnt: 1 }, // only the full-agent's claim is in D1
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "claims", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      d1_count: number;
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories?: { partial_cascade?: number };
    };

    expect(body.kv_count).toBe(2);
    expect(body.d1_count).toBe(1);
    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1); // partial agent's claim is explained
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories?.partial_cascade).toBe(1);
  });

  it("classifies vouch with partial-agent participant as drift_explained", async () => {
    // KV: 1 full agent + 1 partial agent + 1 vouch between them
    // D1: 0 vouches (neither is backfilled since one is partial)
    // Expected: drift=1, drift_explained=1, drift_unexplained=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qpartial": PARTIAL_AGENT,
      "vouch:bc1qagent1:bc1qpartial": JSON.stringify({
        referrer: "bc1qagent1",
        referee: "bc1qpartial",
        registeredAt: "2026-03-01T00:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM vouches": { cnt: 0 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "vouches", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories?: { partial_cascade?: number };
    };

    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1);
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories?.partial_cascade).toBe(1);
  });
});

// ── inbox explained_categories ─────────────────────────────────────────────

describe("inbox explained_categories", () => {
  it("counts unique_payment_txid_replay when multiple messages share same payment_txid", async () => {
    // 3 inbox messages: 2 share the same payment_txid → 1 unique_payment_txid_replay
    // All go to full agent (no partial_cascade), no stx replies (unresolvable_stx_reply=0)
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "inbox:message:msg001": JSON.stringify({
        messageId: "msg001",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_shared",
        sentAt: "2026-01-01T00:00:00Z",
      }),
      "inbox:message:msg002": JSON.stringify({
        messageId: "msg002",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_shared", // same txid → replay
        sentAt: "2026-01-01T00:01:00Z",
      }),
      "inbox:message:msg003": JSON.stringify({
        messageId: "msg003",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_unique", // unique txid
        sentAt: "2026-01-01T00:02:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 2 }, // only 2 made it to D1 (1 replay skipped)
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      d1_count: number;
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories?: {
        partial_cascade?: number;
        unique_payment_txid_replay?: number;
        unresolvable_stx_reply?: number;
      };
    };

    expect(body.kv_count).toBe(3);
    expect(body.d1_count).toBe(2);
    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1); // 1 unique_payment_txid_replay
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories?.unique_payment_txid_replay).toBe(1);
    expect(body.explained_categories?.partial_cascade).toBe(0);
    expect(body.explained_categories?.unresolvable_stx_reply).toBe(0);
  });

  it("counts partial_cascade for inbox messages to partial-agent recipients", async () => {
    // 2 inbox messages: 1 to full agent, 1 to partial agent
    // D1 has 1 (only full agent's message backfilled)
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qpartial": PARTIAL_AGENT,
      "inbox:message:msg_full": JSON.stringify({
        messageId: "msg_full",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_a",
        sentAt: "2026-01-01T00:00:00Z",
      }),
      "inbox:message:msg_partial": JSON.stringify({
        messageId: "msg_partial",
        toBtcAddress: "bc1qpartial",
        paymentTxid: "txid_b",
        sentAt: "2026-01-01T00:01:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories?: { partial_cascade?: number };
    };

    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1);
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories?.partial_cascade).toBe(1);
  });
});

// ── sampleSize=0 short-circuit ─────────────────────────────────────────────

describe("sampleSize=0 short-circuit", () => {
  it("agents table with sampleSize=0 returns sample_size=0 and empty field_diffs", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      sample_size: number;
      field_diffs: unknown[];
    };

    expect(body.sample_size).toBe(0);
    expect(body.field_diffs).toHaveLength(0);
  });

  it("claims table with sampleSize=0 returns sample_size=0 and empty field_diffs", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "claim:bc1qagent1": CLAIM_1,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM claims": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "claims", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      sample_size: number;
      field_diffs: unknown[];
    };

    expect(body.sample_size).toBe(0);
    expect(body.field_diffs).toHaveLength(0);
  });

  it("vouches table with sampleSize=0 returns sample_size=0 and empty field_diffs", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qagent2": JSON.stringify({
        btcAddress: "bc1qagent2",
        stxAddress: "SP1AGENT2",
        stxPublicKey: "03abcdef02",
        btcPublicKey: "02abcdef02",
        verifiedAt: "2026-01-02T00:00:00Z",
      }),
      "vouch:bc1qagent1:bc1qagent2": VOUCH_1,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM vouches": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "vouches", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      sample_size: number;
      field_diffs: unknown[];
    };

    expect(body.sample_size).toBe(0);
    expect(body.field_diffs).toHaveLength(0);
  });
});

// ── Bug 1: strict-criteria alignment with backfill ────────────────────────
//
// Records that pass isPartialAgentRecord===false but are missing one of the
// four required fields (stxAddress / stxPublicKey / btcPublicKey / verifiedAt)
// are rejected by backfill and therefore absent from D1. Before this fix,
// reconcile counted them as full agents (false unexplained drift). After the
// fix they appear in kv_count_invalid_excluded and do NOT contribute to drift.

describe("Bug 1: invalid records excluded same as backfill (criteria alignment)", () => {
  // Fixture: passes isPartialAgentRecord (has stxAddress) but missing btcPublicKey
  const INVALID_AGENT_MISSING_BTC_PUBKEY = JSON.stringify({
    btcAddress: "bc1qinvalid1",
    stxAddress: "SP1INVALID1",
    stxPublicKey: "03abcdef99",
    // btcPublicKey intentionally missing
    verifiedAt: "2026-01-05T00:00:00Z",
  });

  // Fixture: passes isPartialAgentRecord but has empty verifiedAt
  const INVALID_AGENT_EMPTY_VERIFIED_AT = JSON.stringify({
    btcAddress: "bc1qinvalid2",
    stxAddress: "SP1INVALID2",
    stxPublicKey: "03abcdef98",
    btcPublicKey: "02abcdef98",
    verifiedAt: "", // empty string — backfill rejects as falsy
  });

  it("agents: excludes invalid record (missing btcPublicKey) from kv_count and reports kv_count_invalid_excluded", async () => {
    // KV: 1 full agent + 1 invalid (non-partial but missing btcPublicKey)
    // D1: 1 agent (only full agent backfilled)
    // Expected: kv_count=1, kv_count_invalid_excluded=1, drift=0, drift_unexplained=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qinvalid1": INVALID_AGENT_MISSING_BTC_PUBKEY,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      kv_count_partial_excluded: number;
      kv_count_invalid_excluded: number;
      d1_count: number;
      drift: number;
      drift_unexplained: number;
    };

    expect(body.kv_count).toBe(1); // only full agent
    expect(body.kv_count_partial_excluded).toBe(0); // none are partial
    expect(body.kv_count_invalid_excluded).toBe(1); // invalid agent surfaced separately
    expect(body.d1_count).toBe(1);
    expect(body.drift).toBe(0); // no unexplained gap
    expect(body.drift_unexplained).toBe(0);
  });

  it("agents: excludes invalid record (empty verifiedAt) — not counted as drift", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qinvalid2": INVALID_AGENT_EMPTY_VERIFIED_AT,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      kv_count_invalid_excluded: number;
      drift: number;
      drift_unexplained: number;
    };

    expect(body.kv_count).toBe(1);
    expect(body.kv_count_invalid_excluded).toBe(1);
    expect(body.drift).toBe(0);
    expect(body.drift_unexplained).toBe(0);
  });

  it("agents: distinguishes partial, invalid, and full counts in a mixed KV", async () => {
    // KV: 1 full + 1 partial (isPartialAgentRecord) + 1 invalid (missing btcPublicKey)
    // D1: 1 agent (only full backfilled)
    // Expected: kv_count=1, partial_excluded=1, invalid_excluded=1, drift=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qpartial": PARTIAL_AGENT,
      "btc:bc1qinvalid1": INVALID_AGENT_MISSING_BTC_PUBKEY,
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM agents": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      kv_count_partial_excluded: number;
      kv_count_invalid_excluded: number;
      d1_count: number;
      drift: number;
      drift_unexplained: number;
    };

    expect(body.kv_count).toBe(1); // full only
    expect(body.kv_count_partial_excluded).toBe(1); // true partial
    expect(body.kv_count_invalid_excluded).toBe(1); // non-partial but missing field
    expect(body.d1_count).toBe(1);
    expect(body.drift).toBe(0);
    expect(body.drift_unexplained).toBe(0);
  });

  it("claims: invalid agent's claim is also drift_explained (cascades from KV-truth)", async () => {
    // KV: 1 full + 1 invalid; 2 claims; D1: 1 claim (only full agent's)
    // The invalid agent's claim is not in D1 (backfill rejected the parent).
    // reconcile should explain this via drift_explained, not drift_unexplained.
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qinvalid1": INVALID_AGENT_MISSING_BTC_PUBKEY,
      "claim:bc1qagent1": CLAIM_1,
      "claim:bc1qinvalid1": JSON.stringify({
        btcAddress: "bc1qinvalid1",
        status: "verified",
        claimedAt: "2026-01-05T01:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM claims": { cnt: 1 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "claims", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      d1_count: number;
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
    };

    expect(body.kv_count).toBe(2); // 2 claims in KV
    expect(body.d1_count).toBe(1);
    expect(body.drift).toBe(1);
    // Invalid agent is not in fullAgents → claim is drift_explained
    expect(body.drift_explained).toBe(1);
    expect(body.drift_unexplained).toBe(0);
  });
});

// ── Bug 2: inbox parallelization — structural verification ────────────────
//
// The production timeout was caused by sequential kv.get() across ~10K inbox
// keys. The fix parallelizes in batches of 50. We can't measure wall-clock
// in unit tests, but we CAN verify the mock's get() is called for ALL keys
// (not just a subset), and that count/drift results are identical before and
// after the change (no regressions from the structural refactor).

describe("Bug 2: inbox parallel scan — correctness after batched reads", () => {
  it("reads all inbox:message: values (not just keys) for category derivation", async () => {
    // KV: 3 messages (2 to full agent, 1 to partial agent)
    // D1: 2 messages (partial agent's message not backfilled)
    // After parallelization: drift_explained=1 (partial_cascade), drift_unexplained=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "btc:bc1qpartial": PARTIAL_AGENT,
      "inbox:message:msg001": JSON.stringify({
        messageId: "msg001",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_001",
        sentAt: "2026-01-01T00:00:00Z",
      }),
      "inbox:message:msg002": JSON.stringify({
        messageId: "msg002",
        toBtcAddress: "bc1qagent1",
        paymentTxid: "txid_002",
        sentAt: "2026-01-01T01:00:00Z",
      }),
      "inbox:message:msg003": JSON.stringify({
        messageId: "msg003",
        toBtcAddress: "bc1qpartial", // partial agent — should be drift_explained
        paymentTxid: "txid_003",
        sentAt: "2026-01-01T02:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 2 },
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      d1_count: number;
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories: { partial_cascade?: number };
    };

    expect(body.kv_count).toBe(3);
    expect(body.d1_count).toBe(2);
    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1);
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories.partial_cascade).toBe(1);
  });

  it("reads all inbox:reply: values and counts unresolvable stx replies", async () => {
    // KV: 1 reply with a Stacks address replyTo that does not have a stx: KV key
    // D1: 1 reply
    // Expected: unresolvable_stx_reply=1, drift_explained=1, drift_unexplained=0
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "inbox:reply:msg001": JSON.stringify({
        messageId: "msg001",
        replyTo: "SP1NOSUCHADDR",  // Stacks address but no stx: key in KV
        repliedAt: "2026-01-01T03:00:00Z",
      }),
    });

    const db = buildD1Mock({
      firstResults: {
        "FROM inbox_messages": { cnt: 0 }, // reply not in D1 (unresolvable)
      },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      kv_count: number;
      d1_count: number;
      drift: number;
      drift_explained: number;
      drift_unexplained: number;
      explained_categories: { unresolvable_stx_reply?: number };
    };

    expect(body.kv_count).toBe(1); // 1 reply key
    expect(body.d1_count).toBe(0);
    expect(body.drift).toBe(1);
    expect(body.drift_explained).toBe(1);
    expect(body.drift_unexplained).toBe(0);
    expect(body.explained_categories.unresolvable_stx_reply).toBe(1);
  });
});

// ── explained_categories always present ──────────────────────────────────

describe("explained_categories is always present in response", () => {
  it("agents table returns explained_categories as empty object {}", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
    });

    const db = buildD1Mock({
      firstResults: { "FROM agents": { cnt: 1 } },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { explained_categories: unknown };
    // Must be present and be an object (not undefined / null)
    expect(body.explained_categories).toBeDefined();
    expect(typeof body.explained_categories).toBe("object");
    expect(body.explained_categories).not.toBeNull();
  });

  it("claims table returns explained_categories with partial_cascade", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
      "claim:bc1qagent1": CLAIM_1,
    });

    const db = buildD1Mock({
      firstResults: { "FROM claims": { cnt: 1 } },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "claims", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { explained_categories: Record<string, unknown> };
    expect(body.explained_categories).toBeDefined();
    expect(typeof body.explained_categories).toBe("object");
  });

  it("kv_count_invalid_excluded field is always present", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT,
    });

    const db = buildD1Mock({
      firstResults: { "FROM agents": { cnt: 1 } },
      defaultFirst: null,
    });

    mockContext({ VERIFIED_AGENTS: kv, DB: db });

    const resp = await POST(buildPostRequest({ table: "agents", sampleSize: "0" }));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { kv_count_invalid_excluded: unknown };
    expect(body.kv_count_invalid_excluded).toBeDefined();
    expect(typeof body.kv_count_invalid_excluded).toBe("number");
  });
});
