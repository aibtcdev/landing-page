/**
 * Tests for POST /api/admin/backfill — KV → D1 hydrator.
 *
 * Tests call the real GET/POST handlers with mocked getCloudflareContext()
 * and a controlled KV + D1 mock environment, matching the pattern from
 * app/api/outbox/[address]/__tests__/rate-limit.test.ts.
 *
 * FK ordering note: The inbox_messages table stores inbound messages first
 * (is_reply=0), then reply rows (is_reply=1) with reply_to_message_id pointing
 * to the parent. The route enforces this ordering internally: in backfillInboxMessages(),
 * the inbound `inbox:message:` scan always completes before the `inbox:reply:` scan
 * begins (enforced via encoded cursor: cursor starts as "inbound:", transitions to
 * "reply:" only when inbound is exhausted). This ensures FKs are never violated.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";

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

/**
 * Build a minimal mock KVNamespace from a plain key→value map.
 * Supports get, put, list with prefix + simple numeric cursor pagination.
 */
function buildKvMock(data: Record<string, string>): KVNamespace {
  const store = { ...data };

  const kv = {
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
      const keys = page
        .map((name) => ({ name }));
      return { keys, list_complete: listComplete, cursor: listComplete ? undefined : String(next) };
    }),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;

  return kv;
}

// ── D1 mock helper ───────────────────────────────────────────────────────

interface D1RunResult {
  meta: { changes: number };
  results: unknown[];
  success: boolean;
}

type D1MockConfig = {
  /** How many times run() reports changes=1 before flipping to 0 (idempotent). */
  changesSequence?: number[];
  /** Throw on run() call. */
  throwOnRun?: boolean;
};

/**
 * Build a D1Database mock. Tracks prepare().bind().run() calls.
 *
 * changesSequence: array of values returned for consecutive run() calls.
 *   Default: always returns changes=1 (insert succeeds).
 */
function buildD1Mock(config: D1MockConfig = {}): {
  db: D1Database;
  runMock: Mock;
  prepareMock: Mock;
  bindMock: Mock;
} {
  const sequence = config.changesSequence ?? [];
  let callIndex = 0;

  const runMock = vi.fn(async (): Promise<D1RunResult> => {
    if (config.throwOnRun) throw new Error("D1 error");
    const changes = sequence[callIndex] ?? 1;
    callIndex++;
    return { meta: { changes }, results: [], success: true };
  });

  const firstMock = vi.fn(async (): Promise<{ btc_address: string } | null> => null);

  const boundStatement = {
    run: runMock,
    first: firstMock,
    all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
  };

  const bindMock = vi.fn(() => boundStatement);

  const statement = {
    bind: bindMock,
  };

  const prepareMock = vi.fn(() => statement);

  const db = {
    prepare: prepareMock,
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;

  return { db, runMock, prepareMock, bindMock };
}

// ── Context mock helper ──────────────────────────────────────────────────

function mockContext(env: Partial<CloudflareEnv>) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env: {
      VERIFIED_AGENTS: buildKvMock({}),
      ...env,
    },
    ctx: { waitUntil: vi.fn() },
  });
}

// ── Request builders ─────────────────────────────────────────────────────

function buildPostRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("https://aibtc.com/api/admin/backfill");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), {
    method: "POST",
    headers: {
      "X-Admin-Key": "test-admin-key",
    },
  });
}

function buildGetRequest(): NextRequest {
  return new NextRequest("https://aibtc.com/api/admin/backfill", {
    method: "GET",
    headers: {
      "X-Admin-Key": "test-admin-key",
    },
  });
}

// ── Full AgentRecord fixture ─────────────────────────────────────────────

const FULL_AGENT_1 = JSON.stringify({
  btcAddress: "bc1qagent1",
  stxAddress: "SP1AGENT1",
  stxPublicKey: "03abcdef01",
  btcPublicKey: "02abcdef01",
  verifiedAt: "2026-01-01T00:00:00Z",
  displayName: "Agent One",
  referredBy: null,
});

const PARTIAL_AGENT = JSON.stringify({
  btcAddress: "bc1qpartial",
  btcPublicKey: "02abcdef02",
  verifiedAt: "2026-01-02T00:00:00Z",
  // No stxAddress — this is a PartialAgentRecord
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
  referee: "bc1qnewbie",
  registeredAt: "2026-02-01T00:00:00Z",
  messageSent: false,
  paidOut: false,
});

const REFERRAL_CODE_1 = JSON.stringify({
  code: "ABC123",
  createdAt: "2026-01-01T00:00:00Z",
});

const OUTBOX_REPLY_1 = JSON.stringify({
  messageId: "msg_parent_1",
  fromAddress: "bc1qagent1",
  toBtcAddress: "SP2SENDER1",
  reply: "pong",
  signature: "sig_123",
  repliedAt: "2026-01-01T04:00:00Z",
});

// ── beforeEach ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test 5: admin key required ───────────────────────────────────────────

describe("admin-key required", () => {
  it("GET returns 401 without X-Admin-Key", async () => {
    // Mock admin key env — requireAdmin calls getCloudflareContext internally
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "secret" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest("https://aibtc.com/api/admin/backfill", {
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

    const req = new NextRequest("https://aibtc.com/api/admin/backfill", {
      method: "POST",
    });
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it("POST with wrong X-Admin-Key returns 401", async () => {
    // requireAdmin uses HMAC comparison against ARC_ADMIN_API_KEY
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "the-real-secret" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = new NextRequest("https://aibtc.com/api/admin/backfill", {
      method: "POST",
      headers: { "X-Admin-Key": "wrong-key" },
    });
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });
});

// ── Test 1: dry-run ──────────────────────────────────────────────────────

describe("dry-run mode", () => {
  it("counts rows without writing to D1 or KV for referral code", async () => {
    const kv = buildKvMock({
      // 2 agents: 1 full, 1 partial
      "btc:bc1qagent1": FULL_AGENT_1,
      "btc:bc1qpartial": PARTIAL_AGENT,
      // referral code present for full agent
      "referral-code:bc1qagent1": REFERRAL_CODE_1,
      // 1 claim
      "claim:bc1qagent1": CLAIM_1,
      // 1 vouch
      "vouch:bc1qagent1:bc1qnewbie": VOUCH_1,
    });

    const { db, runMock } = buildD1Mock();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildPostRequest({ table: "all", dryRun: "true" });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      inserted: number;
      skipped_partial: number;
      skipped_idempotent: number;
      dryRun: boolean;
    };

    // 1 full agent + 1 claim + 1 vouch = 3 inserted; partial not counted in inserted
    expect(body.inserted).toBe(3);
    expect(body.skipped_partial).toBe(1);
    expect(body.dryRun).toBe(true);

    // D1 run() must NOT have been called in dry run
    expect(runMock).not.toHaveBeenCalled();

    // KV put for referral code must NOT have been called in dry run
    expect((kv.put as Mock)).not.toHaveBeenCalled();
  });
});

// ── Test 2: idempotency on agents ────────────────────────────────────────

describe("idempotency", () => {
  it("first run inserts; second run skips (idempotent) via INSERT OR IGNORE", async () => {
    const kv = buildKvMock({
      "btc:bc1qagent1": FULL_AGENT_1,
      "referral-code:bc1qagent1": REFERRAL_CODE_1,
    });

    // First call: changes=1 (insert succeeds)
    const { db: db1, runMock: runMock1 } = buildD1Mock({ changesSequence: [1] });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db1,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req1 = buildPostRequest({ table: "agents" });
    const resp1 = await POST(req1);
    const body1 = await resp1.json() as { inserted: number; skipped_idempotent: number };
    expect(body1.inserted).toBe(1);
    expect(body1.skipped_idempotent).toBe(0);
    expect(runMock1).toHaveBeenCalledTimes(1);

    // Second call: D1 returns changes=0 (INSERT OR IGNORE hit existing row)
    const { db: db2, runMock: runMock2 } = buildD1Mock({ changesSequence: [0] });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db2,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req2 = buildPostRequest({ table: "agents" });
    const resp2 = await POST(req2);
    const body2 = await resp2.json() as { inserted: number; skipped_idempotent: number };
    expect(body2.inserted).toBe(0);
    expect(body2.skipped_idempotent).toBe(1);
    expect(runMock2).toHaveBeenCalledTimes(1);
  });

  it("backfills referredBy in a second pass to avoid self-FK ordering issues", async () => {
    const parentAgent = JSON.stringify({
      btcAddress: "bc1qparent",
      stxAddress: "SP1PARENT",
      stxPublicKey: "03parent",
      btcPublicKey: "02parent",
      verifiedAt: "2026-01-01T00:00:00Z",
      referredBy: null,
    });
    const childAgent = JSON.stringify({
      btcAddress: "bc1qchild",
      stxAddress: "SP1CHILD",
      stxPublicKey: "03child",
      btcPublicKey: "02child",
      verifiedAt: "2026-01-01T00:00:00Z",
      referredBy: "bc1qparent",
    });

    const kv = buildKvMock({
      "btc:bc1qchild": childAgent,
      "btc:bc1qparent": parentAgent,
      "referral-code:bc1qchild": REFERRAL_CODE_1,
      "referral-code:bc1qparent": JSON.stringify({ code: "XYZ789", createdAt: "2026-01-01T00:00:00Z" }),
    });

    const { db, bindMock } = buildD1Mock({ changesSequence: [1, 1, 1] });

    mockContext({
      ARC_ADMIN_API_KEY: "test-admin-key",
      VERIFIED_AGENTS: kv,
      DB: db,
    });

    const resp1 = await POST(buildPostRequest({ table: "agents" }));
    const body1 = await resp1.json() as { inserted: number; failed: unknown[]; cursor: string | null };
    expect(body1.inserted).toBe(2);
    expect(body1.failed).toHaveLength(0);
    expect(body1.cursor).toBe("referred_by:");

    const insertChildBind = bindMock.mock.calls[0] as unknown[];
    expect(insertChildBind[16]).toBe("ABC123");

    const resp2 = await POST(buildPostRequest({ table: "agents", cursor: body1.cursor! }));
    const body2 = await resp2.json() as { failed: unknown[]; cursor: string | null };
    expect(body2.failed).toHaveLength(0);
    expect(body2.cursor).toBeNull();

    const updateBind = bindMock.mock.calls[2] as unknown[];
    expect(updateBind).toEqual(["bc1qparent", "bc1qchild", "bc1qparent"]);
  });
});

// ── Test 3: missing referral code generates one ──────────────────────────

describe("referral code generation", () => {
  it("generates and stores a referral code when none exists in KV", async () => {
    const kv = buildKvMock({
      // Full agent but NO referral-code: entry
      "btc:bc1qagent1": FULL_AGENT_1,
    });

    const { db } = buildD1Mock({ changesSequence: [1] });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildPostRequest({ table: "agents" });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const body = await resp.json() as { inserted: number; failed: unknown[] };
    expect(body.inserted).toBe(1);
    expect(body.failed).toHaveLength(0);

    // KV put should have been called for both referral-code: and referral-lookup: keys
    const kvPutMock = kv.put as Mock;
    const putCalls = kvPutMock.mock.calls.map(([key]: [string]) => key);

    const hasReferralCodeKey = putCalls.some((k: string) =>
      k.startsWith("referral-code:bc1qagent1")
    );
    const hasReferralLookupKey = putCalls.some((k: string) =>
      k.startsWith("referral-lookup:")
    );

    expect(hasReferralCodeKey).toBe(true);
    expect(hasReferralLookupKey).toBe(true);
  });
});

// ── Test 4: vouches table happy path ─────────────────────────────────────

describe("vouches table backfill", () => {
  it("inserts a single vouch record into D1", async () => {
    const kv = buildKvMock({
      "vouch:bc1qagent1:bc1qnewbie": VOUCH_1,
    });

    const { db, runMock } = buildD1Mock({ changesSequence: [1] });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildPostRequest({ table: "vouches" });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      table: string;
      inserted: number;
      skipped_idempotent: number;
      failed: unknown[];
      cursor: string | null;
    };

    expect(body.table).toBe("vouches");
    expect(body.inserted).toBe(1);
    expect(body.skipped_idempotent).toBe(0);
    expect(body.failed).toHaveLength(0);
    expect(body.cursor).toBeNull();
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("skips vouch:index: keys during scan", async () => {
    const kv = buildKvMock({
      "vouch:bc1qagent1:bc1qnewbie": VOUCH_1,
      "vouch:index:bc1qagent1": JSON.stringify({
        btcAddress: "bc1qagent1",
        refereeAddresses: ["bc1qnewbie"],
        lastVouchAt: "2026-02-01T00:00:00Z",
      }),
    });

    const { db, runMock } = buildD1Mock({ changesSequence: [1] });

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildPostRequest({ table: "vouches" });
    const resp = await POST(req);
    const body = await resp.json() as { inserted: number };

    // Only 1 insert — the vouch:index: entry was skipped
    expect(body.inserted).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});

describe("inbox_messages backfill", () => {
  it("completes inbound pass before reply pass across paginated calls", async () => {
    const bulkMessages = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => {
        const id = `msg_parent_${i + 1}`;
        return [
          `inbox:message:${id}`,
          JSON.stringify({
            messageId: id,
            fromAddress: `SP2SENDER${i + 1}`,
            toBtcAddress: "bc1qagent1",
            toStxAddress: "SP1AGENT1",
            content: `hello-${i + 1}`,
            paymentSatoshis: 100,
            ...(i === 1 ? { replyTo: "msg_parent_1" } : {}),
            sentAt: `2026-01-01T02:${String(i).padStart(2, "0")}:00Z`,
          }),
        ];
      })
    );

    const kv = buildKvMock({
      ...bulkMessages,
      "inbox:reply:msg_parent_1": OUTBOX_REPLY_1,
      "stx:SP2SENDER1": FULL_AGENT_1,
    });

    const { db, bindMock } = buildD1Mock({ changesSequence: [1, 1, 1] });

    mockContext({
      ARC_ADMIN_API_KEY: "test-admin-key",
      VERIFIED_AGENTS: kv,
      DB: db,
    });

    const resp1 = await POST(buildPostRequest({ table: "inbox_messages", batchSize: "10" }));
    const body1 = await resp1.json() as { inserted: number; cursor: string | null };
    expect(body1.inserted).toBe(10);
    expect(body1.cursor).toBe("inbound:10");

    const resp2 = await POST(
      buildPostRequest({ table: "inbox_messages", batchSize: "1", cursor: body1.cursor! })
    );
    const body2 = await resp2.json() as { inserted: number; cursor: string | null };
    expect(body2.inserted).toBe(1);
    expect(body2.cursor).toBe("reply:");

    const resp3 = await POST(
      buildPostRequest({ table: "inbox_messages", batchSize: "1", cursor: body2.cursor! })
    );
    const body3 = await resp3.json() as { inserted: number; cursor: string | null };
    expect(body3.inserted).toBe(1);
    expect(body3.cursor).toBeNull();

    const inboundFirstBind = bindMock.mock.calls[0] as unknown[];
    const inboundWithReplyTo = bindMock.mock.calls.find(
      (args) => (args as unknown[])[1] === "msg_parent_1"
    ) as unknown[] | undefined;
    const replyBind = bindMock.mock.calls[11] as unknown[];

    expect(inboundWithReplyTo).toBeDefined();
    expect(inboundFirstBind[1]).toBeNull();
    expect(replyBind[0]).toBe("reply_msg_parent_1");
    expect(replyBind[1]).toBe("msg_parent_1");
  });

  it("resolves reply to_btc_address from stx: lookup when reply stores an STX principal", async () => {
    const stxPrincipal = "SP1234567890ABCDEFGHJKLMNPQRSTUVWX123456";
    const replyWithStxRecipient = JSON.stringify({
      ...JSON.parse(OUTBOX_REPLY_1) as Record<string, unknown>,
      toBtcAddress: stxPrincipal,
    });

    const kv = buildKvMock({
      "inbox:reply:msg_parent_1": replyWithStxRecipient,
      [`stx:${stxPrincipal}`]: JSON.stringify({
        btcAddress: "bc1qsenderbtc",
        stxAddress: stxPrincipal,
      }),
    });

    const { db, bindMock, runMock } = buildD1Mock({ changesSequence: [1] });

    mockContext({
      ARC_ADMIN_API_KEY: "test-admin-key",
      VERIFIED_AGENTS: kv,
      DB: db,
    });

    const resp = await POST(buildPostRequest({ table: "inbox_messages", cursor: "reply:" }));
    const body = await resp.json() as { inserted: number; failed: unknown[] };

    expect(body.inserted).toBe(1);
    expect(body.failed).toHaveLength(0);
    expect(runMock).toHaveBeenCalledTimes(1);

    const bindArgs = bindMock.mock.calls[0] as unknown[];
    expect(bindArgs[3]).toBe("bc1qsenderbtc");
  });
});

// ── GET self-doc test ────────────────────────────────────────────────────

describe("GET self-documentation", () => {
  it("returns 200 with endpoint description for authenticated admin", async () => {
    // requireAdmin reads ARC_ADMIN_API_KEY from env
    (getCloudflareContext as Mock).mockResolvedValue({
      env: { ARC_ADMIN_API_KEY: "test-admin-key" },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildGetRequest();
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const body = await resp.json() as { endpoint: string; methods: string[] };
    expect(body.endpoint).toBe("/api/admin/backfill");
    expect(body.methods).toContain("POST");
  });
});

// ── claims backfill tests ────────────────────────────────────────────────

describe("claims backfill", () => {
  it("skips rows with invalid status values and records them in failed[]", async () => {
    const badClaim = JSON.stringify({
      btcAddress: "bc1qbad",
      displayName: "Bad Agent",
      tweetUrl: "https://x.com/bad/123",
      tweetAuthor: null,
      claimedAt: "2026-01-01T00:00:00Z",
      rewardSatoshis: 0,
      rewardTxid: null,
      // invalid status — not in the CHECK constraint enum
      status: "unknown_status",
    });

    const kv = buildKvMock({ "claim:bc1qbad": badClaim });
    const { db, runMock } = buildD1Mock();

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        ARC_ADMIN_API_KEY: "test-admin-key",
        VERIFIED_AGENTS: kv,
        DB: db,
      },
      ctx: { waitUntil: vi.fn() },
    });

    const req = buildPostRequest({ table: "claims" });
    const resp = await POST(req);
    const body = await resp.json() as {
      inserted: number;
      failed: { key: string; reason: string }[];
    };

    expect(body.inserted).toBe(0);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].key).toBe("claim:bc1qbad");
    expect(body.failed[0].reason).toContain("Invalid status value");

    // D1 run should NOT have been called for the bad row
    expect(runMock).not.toHaveBeenCalled();
  });
});
