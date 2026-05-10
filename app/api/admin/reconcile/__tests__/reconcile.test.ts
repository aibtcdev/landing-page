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
    for (const [keyword, result] of Object.entries(firstResults)) {
      if (query.includes(keyword)) return result;
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
    // 150 KV total, 50 partial → 100 full; D1 has 100 → no raw drift
    // drift_explained=50 is informational (FK cascade rows), drift_unexplained = 0 - 50 = -50
    // But this scenario is for claims/inbox/vouches where kv_count_partial=0 and
    // drift_explained is the number of FK-cascade rows
    const result = computeDrift(100, 0, 60, 40);
    expect(result.kv_count_full).toBe(100);
    expect(result.drift).toBe(40);
    expect(result.drift_explained).toBe(40);
    expect(result.drift_unexplained).toBe(0);
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
});
