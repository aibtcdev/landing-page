/**
 * Tests for the four public competition round read endpoints added in Phase 2
 * of quest 2026-05-20-competition-rounds-read-endpoints.
 *
 * Routes under test:
 *   GET /api/competition/rounds                                    (list)
 *   GET /api/competition/rounds/[roundId]                         (detail)
 *   GET /api/competition/rounds/[roundId]/results/[stxAddress]    (per-agent permalink)
 *   GET /api/competition/status?address=...                       (latestRoundResult extension)
 *
 * Mock pattern mirrors app/api/competition/__tests__/d1-throws-fallback.test.ts:
 *   vi.mock declarations appear before route imports.
 *   getCloudflareContext returns { env, ctx } with typed mock bindings.
 *   Each test clears mocks via beforeEach.
 *
 * Quest: 2026-05-20-competition-rounds-read-endpoints, Phase 2.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ── Module mocks (must be declared before route imports) ──────────────────────

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/competition/finalize/read", () => ({
  listFinalizedRounds: vi.fn(),
  getFinalizedRound: vi.fn(),
  getRoundResults: vi.fn(),
  getRoundRewards: vi.fn(),
  getRoundResultForAgent: vi.fn(),
  getLatestFinalizedRoundResultForAgent: vi.fn(),
}));

vi.mock("@/lib/competition/d1-reads", () => ({
  getCompetitionStatusFromD1: vi.fn(),
  listSwapsFromD1: vi.fn(),
  countSwapsFromD1: vi.fn(),
  encodeSwapsCursor: vi.fn((t: number, x: string) => `enc(${t},${x})`),
  decodeSwapsCursor: vi.fn(),
}));

// ── Route imports (after mocks) ───────────────────────────────────────────────

import { GET as listGet } from "../rounds/route";
import { GET as detailGet } from "../rounds/[roundId]/route";
import { GET as agentResultGet } from "../rounds/[roundId]/results/[stxAddress]/route";
import { GET as statusGet } from "../status/route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  listFinalizedRounds,
  getFinalizedRound,
  getRoundResults,
  getRoundRewards,
  getRoundResultForAgent,
  getLatestFinalizedRoundResultForAgent,
} from "@/lib/competition/finalize/read";
import { getCompetitionStatusFromD1 } from "@/lib/competition/d1-reads";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUND_ID = "week-1-2026-05-13";
const STX_ADDRESS = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";

const MOCK_ROUND = {
  round_id: ROUND_ID,
  starts_at: 1778700600,
  ends_at: 1779305400,
  grace_ends_at: 1779309000,
  status: "finalized",
  min_volume_usd: 50.0,
  min_priced_trade_count: 3,
  created_at: "2026-05-13T19:30:00Z",
  finalized_at: "2026-05-20T20:00:00.000Z",
};

const MOCK_RESULT = {
  round_id: ROUND_ID,
  rank: 1,
  stx_address: STX_ADDRESS,
  btc_address: "bc1qagenta",
  erc8004_agent_id: 42,
  trade_count: 5,
  priced_trade_count: 5,
  unpriced_trade_count: 0,
  volume_usd: 1.0,
  received_usd: 1.0248,
  pnl_usd: 0.0248,
  pnl_percent: 0.0248,
  latest_trade_at: 1779000000,
  result_json: { source_counts: { agent: 3, cron: 2, chainhook: 0 }, unpriced_tokens: [] },
  calculated_at: "2026-05-20T20:00:00.000Z",
};

const MOCK_REWARD = {
  round_id: ROUND_ID,
  category: "overall_pnl",
  rank: 1,
  stx_address: STX_ADDRESS,
  erc8004_agent_id: 42,
  amount_sats: 0,
  status: "pending",
  payout_txid: null,
  paid_at: null,
  notes: null,
  created_at: "2026-05-20T20:00:00.000Z",
};

const MOCK_STATUS = {
  address: STX_ADDRESS,
  agent_id: 42,
  registered: true,
  trade_count: 5,
  verified_trade_count: 5,
  first_trade_at: 1778700000,
  last_trade_at: 1779000000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockRateLimit(allow = true) {
  return { limit: vi.fn().mockResolvedValue({ success: allow }) };
}

function buildEnv(dbPresent = true) {
  return {
    DB: dbPresent ? ({ prepare: vi.fn() } as unknown as D1Database) : undefined,
    RATE_LIMIT_READ: mockRateLimit(true),
    LOGS: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getCloudflareContext as Mock).mockResolvedValue({
    env: buildEnv(),
    ctx: { waitUntil: vi.fn() },
  });
});

// ── 1. Rounds list — GET /api/competition/rounds ──────────────────────────────

describe("rounds list — GET /api/competition/rounds", () => {
  function buildRequest(qs = "") {
    return new NextRequest(`https://aibtc.com/api/competition/rounds${qs}`, { method: "GET" });
  }

  it("?docs=1 returns doc payload without touching D1", async () => {
    const res = await listGet(buildRequest("?docs=1"));
    expect(res.status).toBe(200);
    expect(listFinalizedRounds).not.toHaveBeenCalled();
    const body = (await res.json()) as any;
    expect(body.endpoint).toBe("/api/competition/rounds");
  });

  it("returns rounds array with pagination on happy path", async () => {
    (listFinalizedRounds as Mock).mockResolvedValue([MOCK_ROUND]);

    const res = await listGet(buildRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0].round_id).toBe(ROUND_ID);
    expect(body.pagination).toMatchObject({ limit: 20, offset: 0, hasMore: false });
  });

  it("hasMore=true when more rows exist beyond the page", async () => {
    // Return limit+1 rows to trigger hasMore
    const extraRows = Array.from({ length: 21 }, (_, i) => ({
      ...MOCK_ROUND,
      round_id: `week-${i + 1}`,
    }));
    (listFinalizedRounds as Mock).mockResolvedValue(extraRows);

    const res = await listGet(buildRequest("?limit=20"));
    const body = (await res.json()) as any;
    expect(body.pagination.hasMore).toBe(true);
    expect(body.rounds).toHaveLength(20);
  });

  it("pagination default: limit=20, offset=0", async () => {
    (listFinalizedRounds as Mock).mockResolvedValue([]);
    await listGet(buildRequest());
    expect(listFinalizedRounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 21, offset: 0 }) // limit+1 for hasMore detection
    );
  });

  it("limit is clamped to max 100", async () => {
    (listFinalizedRounds as Mock).mockResolvedValue([]);
    await listGet(buildRequest("?limit=999"));
    expect(listFinalizedRounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 101 }) // 100+1 for hasMore detection
    );
  });

  it("negative offset returns 400", async () => {
    const res = await listGet(buildRequest("?offset=-1"));
    expect(res.status).toBe(400);
    expect(listFinalizedRounds).not.toHaveBeenCalled();
  });

  it("invalid non-integer limit returns 400", async () => {
    const res = await listGet(buildRequest("?limit=abc"));
    expect(res.status).toBe(400);
    expect(listFinalizedRounds).not.toHaveBeenCalled();
  });

  it("invalid non-integer offset returns 400", async () => {
    const res = await listGet(buildRequest("?offset=abc"));
    expect(res.status).toBe(400);
    expect(listFinalizedRounds).not.toHaveBeenCalled();
  });

  it("returns 503 when DB binding is missing", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: buildEnv(false),
      ctx: { waitUntil: vi.fn() },
    });
    const res = await listGet(buildRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 when listFinalizedRounds throws", async () => {
    (listFinalizedRounds as Mock).mockRejectedValue(new Error("D1_ERROR: connection reset"));
    const res = await listGet(buildRequest());
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("transient_d1_unavailable");
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

// ── 2. Round detail — GET /api/competition/rounds/[roundId] ───────────────────

describe("round detail — GET /api/competition/rounds/[roundId]", () => {
  function buildRequest(roundId: string, qs = "") {
    return new NextRequest(
      `https://aibtc.com/api/competition/rounds/${roundId}${qs}`,
      { method: "GET" }
    );
  }

  it("?docs=1 returns doc payload without touching D1", async () => {
    const res = await detailGet(buildRequest(ROUND_ID, "?docs=1"), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });
    expect(res.status).toBe(200);
    expect(getFinalizedRound).not.toHaveBeenCalled();
    const body = (await res.json()) as any;
    expect(body.endpoint).toBe("/api/competition/rounds/{roundId}");
  });

  it("returns round + results + rewards on happy path", async () => {
    (getFinalizedRound as Mock).mockResolvedValue(MOCK_ROUND);
    (getRoundResults as Mock).mockResolvedValue([MOCK_RESULT]);
    (getRoundRewards as Mock).mockResolvedValue([MOCK_REWARD]);

    const res = await detailGet(buildRequest(ROUND_ID), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.round.round_id).toBe(ROUND_ID);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].rank).toBe(1);
    expect(body.rewards).toHaveLength(1);
    expect(body.rewards[0].category).toBe("overall_pnl");
  });

  it("returns 404 when getFinalizedRound returns null (unknown round)", async () => {
    (getFinalizedRound as Mock).mockResolvedValue(null);

    const res = await detailGet(buildRequest("nonexistent-round"), {
      params: Promise.resolve({ roundId: "nonexistent-round" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("round_not_found");
  });

  it("returns 404 when round is in-flight (non-finalized leak guard)", async () => {
    // getFinalizedRound returns null for in-flight rounds because the SQL WHERE
    // clause excludes non-visible statuses. The route cannot distinguish between
    // "does not exist" and "exists but not visible" — both yield 404, which is
    // the correct behavior to avoid leaking in-flight round data.
    (getFinalizedRound as Mock).mockResolvedValue(null);

    const res = await detailGet(buildRequest("week-2-open"), {
      params: Promise.resolve({ roundId: "week-2-open" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("round_not_found");
    // Confirm no results were leaked
    expect(getRoundResults).not.toHaveBeenCalled();
  });

  it("returns 503 when DB binding is missing", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: buildEnv(false),
      ctx: { waitUntil: vi.fn() },
    });
    const res = await detailGet(buildRequest(ROUND_ID), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 when D1 throws", async () => {
    (getFinalizedRound as Mock).mockRejectedValue(new Error("D1_ERROR: timeout"));
    const res = await detailGet(buildRequest(ROUND_ID), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("transient_d1_unavailable");
  });
});

// ── 3. Agent result permalink — GET /api/competition/rounds/[roundId]/results/[stxAddress] ──

describe("agent result permalink — GET /api/competition/rounds/[roundId]/results/[stxAddress]", () => {
  function buildRequest(roundId: string, stxAddress: string, qs = "") {
    return new NextRequest(
      `https://aibtc.com/api/competition/rounds/${roundId}/results/${stxAddress}${qs}`,
      { method: "GET" }
    );
  }

  it("?docs=1 returns doc payload without touching D1", async () => {
    const res = await agentResultGet(
      buildRequest(ROUND_ID, STX_ADDRESS, "?docs=1"),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: STX_ADDRESS }) }
    );
    expect(res.status).toBe(200);
    expect(getFinalizedRound).not.toHaveBeenCalled();
    const body = (await res.json()) as any;
    expect(body.endpoint).toBe("/api/competition/rounds/{roundId}/results/{stxAddress}");
  });

  it("happy path returns { round_id, result } with RoundResult shape", async () => {
    (getFinalizedRound as Mock).mockResolvedValue(MOCK_ROUND);
    (getRoundResultForAgent as Mock).mockResolvedValue(MOCK_RESULT);

    const res = await agentResultGet(
      buildRequest(ROUND_ID, STX_ADDRESS),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: STX_ADDRESS }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.round_id).toBe(ROUND_ID);
    expect(body.result.rank).toBe(1);
    expect(body.result.stx_address).toBe(STX_ADDRESS);
    expect(body.result.pnl_usd).toBe(0.0248);
    expect(body.result.result_json).toMatchObject({
      source_counts: { agent: 3, cron: 2, chainhook: 0 },
    });
  });

  it("returns 400 on invalid stxAddress", async () => {
    const res = await agentResultGet(
      buildRequest(ROUND_ID, "not-a-stx-address"),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: "not-a-stx-address" }) }
    );
    expect(res.status).toBe(400);
    expect(getFinalizedRound).not.toHaveBeenCalled();
  });

  it("returns 404 when round not found (getFinalizedRound returns null)", async () => {
    (getFinalizedRound as Mock).mockResolvedValue(null);

    const res = await agentResultGet(
      buildRequest("nonexistent-round", STX_ADDRESS),
      { params: Promise.resolve({ roundId: "nonexistent-round", stxAddress: STX_ADDRESS }) }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("round_not_found");
    // Agent result should not be queried when round is not visible
    expect(getRoundResultForAgent).not.toHaveBeenCalled();
  });

  it("returns 404 when agent not placed in the round (getRoundResultForAgent returns null)", async () => {
    (getFinalizedRound as Mock).mockResolvedValue(MOCK_ROUND);
    (getRoundResultForAgent as Mock).mockResolvedValue(null);

    const UNKNOWN_STX = "SP1AGENTNOTPLACEDXXXXXXXXXXXXXXXXXXXXXX5A";
    const res = await agentResultGet(
      buildRequest(ROUND_ID, UNKNOWN_STX),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: UNKNOWN_STX }) }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("agent_not_placed");
  });

  it("returns 503 when DB binding is missing", async () => {
    (getCloudflareContext as Mock).mockResolvedValue({
      env: buildEnv(false),
      ctx: { waitUntil: vi.fn() },
    });
    const res = await agentResultGet(
      buildRequest(ROUND_ID, STX_ADDRESS),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: STX_ADDRESS }) }
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 503 when D1 throws", async () => {
    (getFinalizedRound as Mock).mockRejectedValue(new Error("D1_ERROR: network failure"));

    const res = await agentResultGet(
      buildRequest(ROUND_ID, STX_ADDRESS),
      { params: Promise.resolve({ roundId: ROUND_ID, stxAddress: STX_ADDRESS }) }
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("transient_d1_unavailable");
  });
});

// ── 4. Status endpoint — latestRoundResult extension ─────────────────────────

describe("status endpoint — latestRoundResult extension", () => {
  function buildStatusRequest(address = STX_ADDRESS) {
    return new NextRequest(
      `https://aibtc.com/api/competition/status?address=${address}`,
      { method: "GET" }
    );
  }

  it("agent without placement returns prior shape (no latestRoundResult key)", async () => {
    (getCompetitionStatusFromD1 as Mock).mockResolvedValue(MOCK_STATUS);
    (getLatestFinalizedRoundResultForAgent as Mock).mockResolvedValue(null);

    const res = await statusGet(buildStatusRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // Core fields still present
    expect(body.address).toBe(STX_ADDRESS);
    expect(body.registered).toBe(true);
    expect(body.trade_count).toBe(5);

    // latestRoundResult must be absent when null
    expect(body).not.toHaveProperty("latestRoundResult");
  });

  it("agent placed in week-1 gets latestRoundResult populated in response", async () => {
    (getCompetitionStatusFromD1 as Mock).mockResolvedValue(MOCK_STATUS);
    (getLatestFinalizedRoundResultForAgent as Mock).mockResolvedValue(MOCK_RESULT);

    const res = await statusGet(buildStatusRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // latestRoundResult must be present with correct data
    expect(body).toHaveProperty("latestRoundResult");
    expect(body.latestRoundResult.round_id).toBe(ROUND_ID);
    expect(body.latestRoundResult.rank).toBe(1);
    expect(body.latestRoundResult.pnl_usd).toBe(0.0248);
  });

  it("latestRoundResult failure does not break status response (graceful degradation)", async () => {
    (getCompetitionStatusFromD1 as Mock).mockResolvedValue(MOCK_STATUS);
    (getLatestFinalizedRoundResultForAgent as Mock).mockRejectedValue(
      new Error("D1_ERROR: round table not found")
    );

    const res = await statusGet(buildStatusRequest());
    // Status response should still succeed
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // Core fields present
    expect(body.address).toBe(STX_ADDRESS);
    expect(body.registered).toBe(true);

    // latestRoundResult must be absent on failure (graceful degradation)
    expect(body).not.toHaveProperty("latestRoundResult");
  });

  it("regression: existing response fields remain present with latestRoundResult populated", async () => {
    (getCompetitionStatusFromD1 as Mock).mockResolvedValue(MOCK_STATUS);
    (getLatestFinalizedRoundResultForAgent as Mock).mockResolvedValue(MOCK_RESULT);

    const res = await statusGet(buildStatusRequest());
    const body = (await res.json()) as any;

    // All original fields must still be present
    expect(body.address).toBe(STX_ADDRESS);
    expect(body.agent_id).toBe(42);
    expect(body.registered).toBe(true);
    expect(body.trade_count).toBe(5);
    expect(body.verified_trade_count).toBe(5);
    expect(body.first_trade_at).toBe(1778700000);
    expect(body.last_trade_at).toBe(1779000000);

    // Extension field also present
    expect(body.latestRoundResult.round_id).toBe(ROUND_ID);
  });

  it("returns 503 when base getCompetitionStatusFromD1 throws", async () => {
    (getCompetitionStatusFromD1 as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await statusGet(buildStatusRequest());
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("transient_d1_unavailable");
  });
});
