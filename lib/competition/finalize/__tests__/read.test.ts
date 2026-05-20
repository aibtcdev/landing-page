/**
 * Unit tests for lib/competition/finalize/read.ts
 *
 * Covers:
 *   - listFinalizedRounds: in-flight rounds excluded, pagination bindings, empty case
 *   - getFinalizedRound: found, not-found, in-flight (SQL WHERE excludes it)
 *   - getRoundResults: parseResultJson invoked (result_json is object not string), empty case
 *   - getRoundResultForAgent: found, not-found
 *   - getRoundRewards: populated, empty
 *   - getLatestFinalizedRoundResultForAgent: found, not-found, parseResultJson invoked
 *
 * Mock pattern: each test creates a fresh mock D1 via createReadMockD1() so
 * there is no shared state between cases. The pattern mirrors
 * lib/competition/__tests__/d1-reads.test.ts (simple first/all mocks,
 * no stateful batch routing needed — read helpers never call batch()).
 *
 * Quest: 2026-05-20-competition-rounds-read-endpoints, Phase 1.
 */

import { describe, it, expect, vi } from "vitest";
import {
  listFinalizedRounds,
  getFinalizedRound,
  getRoundResults,
  getRoundResultForAgent,
  getRoundRewards,
  getLatestFinalizedRoundResultForAgent,
} from "../read";
import type { CompetitionRound, RoundResult, CompetitionReward } from "../types";

// ── Mock D1 helpers ───────────────────────────────────────────────────────────

function createPreparedStatement<T = unknown>(
  allRows: T[] = [],
  firstResult: T | null = null
) {
  const stmt = {
    bind: vi.fn(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn().mockResolvedValue({ results: allRows }),
    raw: vi.fn(),
  };
  stmt.bind.mockReturnValue(stmt);
  return stmt;
}

function createReadMockD1<T = unknown>(
  allRows: T[] = [],
  firstResult: T | null = null
): { db: D1Database; stmt: ReturnType<typeof createPreparedStatement<T>> } {
  const stmt = createPreparedStatement<T>(allRows, firstResult);
  const db = {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
  return { db, stmt };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUND_ID = "week-1-2026-05-13";
const STX_ADDRESS = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";

const ROUND_ROW: CompetitionRound = {
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

/** Raw D1 row with result_json as a JSON string (as stored in D1). */
const RESULT_ROW_RAW = {
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
  result_json: JSON.stringify({
    source_counts: { agent: 3, cron: 2, chainhook: 0 },
    unpriced_tokens: [],
  }),
  calculated_at: "2026-05-20T20:00:00.000Z",
};

const REWARD_ROW: CompetitionReward = {
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

// ── listFinalizedRounds ───────────────────────────────────────────────────────

describe("listFinalizedRounds", () => {
  it("returns CompetitionRound[] when finalized rounds exist", async () => {
    const { db } = createReadMockD1([ROUND_ROW]);
    const results = await listFinalizedRounds(db, { limit: 20, offset: 0 });

    expect(results).toHaveLength(1);
    expect(results[0].round_id).toBe(ROUND_ID);
    expect(results[0].status).toBe("finalized");
  });

  it("SQL WHERE clause targets only visible statuses (in-flight rounds excluded by D1)", async () => {
    // The SQL contains status IN (...) — the mock D1 enforces this by only
    // returning the rows we give it. The test asserts the SQL text contains
    // the expected WHERE predicate so route callers cannot accidentally bypass it.
    const { db } = createReadMockD1([ROUND_ROW]);
    await listFinalizedRounds(db, { limit: 20, offset: 0 });

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("status IN");
    expect(sql).toContain("'finalized'");
    expect(sql).toContain("'partially_paid'");
    expect(sql).toContain("'paid'");
    // open / closed / finalizing must NOT appear as allowed statuses
    expect(sql).not.toContain("'open'");
    expect(sql).not.toContain("'closed'");
    expect(sql).not.toContain("'finalizing'");
  });

  it("binds limit and offset correctly (pagination boundaries)", async () => {
    const { db, stmt } = createReadMockD1([]);
    await listFinalizedRounds(db, { limit: 5, offset: 10 });

    expect(stmt.bind).toHaveBeenCalledWith(5, 10);
  });

  it("returns [] when no finalized rounds exist", async () => {
    const { db } = createReadMockD1([]);
    const results = await listFinalizedRounds(db, { limit: 20, offset: 0 });

    expect(results).toEqual([]);
  });
});

// ── getFinalizedRound ─────────────────────────────────────────────────────────

describe("getFinalizedRound", () => {
  it("returns CompetitionRound when round exists with finalized status", async () => {
    const { db } = createReadMockD1([], ROUND_ROW);
    const result = await getFinalizedRound(db, ROUND_ID);

    expect(result).not.toBeNull();
    expect(result?.round_id).toBe(ROUND_ID);
  });

  it("returns null when round does not exist", async () => {
    const { db } = createReadMockD1([], null);
    const result = await getFinalizedRound(db, "nonexistent-round");

    expect(result).toBeNull();
  });

  it("returns null when round is in-flight (SQL WHERE excludes non-visible statuses)", async () => {
    // The D1 WHERE clause filters out open/closed/finalizing rows.
    // We simulate this by having first() return null — exactly what D1 would
    // return when the row exists but status does not match the WHERE predicate.
    const { db } = createReadMockD1([], null);
    const result = await getFinalizedRound(db, ROUND_ID);

    expect(result).toBeNull();
  });

  it("SQL binds roundId to ?1", async () => {
    const { db, stmt } = createReadMockD1([], ROUND_ROW);
    await getFinalizedRound(db, ROUND_ID);

    expect(stmt.bind).toHaveBeenCalledWith(ROUND_ID);
  });
});

// ── getRoundResults ───────────────────────────────────────────────────────────

describe("getRoundResults", () => {
  it("returns RoundResult[] with result_json parsed to an object (not a string)", async () => {
    const { db } = createReadMockD1([RESULT_ROW_RAW]);
    const results = await getRoundResults(db, ROUND_ID);

    expect(results).toHaveLength(1);
    // result_json must be the parsed object, not the raw JSON string
    expect(typeof results[0].result_json).toBe("object");
    expect(results[0].result_json).not.toBeNull();
  });

  it("parseResultJson is invoked — result_json has source_counts and unpriced_tokens", async () => {
    const { db } = createReadMockD1([RESULT_ROW_RAW]);
    const results = await getRoundResults(db, ROUND_ID);

    expect(results[0].result_json).toHaveProperty("source_counts");
    expect(results[0].result_json).toHaveProperty("unpriced_tokens");
    expect(results[0].result_json.source_counts.agent).toBe(3);
    expect(results[0].result_json.source_counts.cron).toBe(2);
    expect(results[0].result_json.unpriced_tokens).toEqual([]);
  });

  it("maps all RoundResult fields correctly", async () => {
    const { db } = createReadMockD1([RESULT_ROW_RAW]);
    const results = await getRoundResults(db, ROUND_ID);
    const r = results[0];

    expect(r.round_id).toBe(ROUND_ID);
    expect(r.rank).toBe(1);
    expect(r.stx_address).toBe(STX_ADDRESS);
    expect(r.trade_count).toBe(5);
    expect(r.volume_usd).toBe(1.0);
    expect(r.pnl_usd).toBe(0.0248);
    expect(r.pnl_percent).toBe(0.0248);
  });

  it("returns [] when round has no results", async () => {
    const { db } = createReadMockD1([]);
    const results = await getRoundResults(db, ROUND_ID);

    expect(results).toEqual([]);
  });

  it("SQL orders results by rank ASC", async () => {
    const { db } = createReadMockD1([]);
    await getRoundResults(db, ROUND_ID);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY rank ASC");
  });
});

// ── getRoundResultForAgent ────────────────────────────────────────────────────

describe("getRoundResultForAgent", () => {
  it("returns RoundResult when agent has a result in the round", async () => {
    const { db } = createReadMockD1([], RESULT_ROW_RAW);
    const result = await getRoundResultForAgent(db, ROUND_ID, STX_ADDRESS);

    expect(result).not.toBeNull();
    expect(result?.stx_address).toBe(STX_ADDRESS);
    expect(result?.round_id).toBe(ROUND_ID);
  });

  it("returns null when agent has no result in the round", async () => {
    const { db } = createReadMockD1([], null);
    const result = await getRoundResultForAgent(db, ROUND_ID, "SP_UNKNOWN");

    expect(result).toBeNull();
  });

  it("parseResultJson is invoked — result_json is an object, not a string", async () => {
    const { db } = createReadMockD1([], RESULT_ROW_RAW);
    const result = await getRoundResultForAgent(db, ROUND_ID, STX_ADDRESS);

    expect(typeof result?.result_json).toBe("object");
    expect(result?.result_json).not.toBeNull();
  });

  it("SQL binds roundId and stxAddress", async () => {
    const { db, stmt } = createReadMockD1([], null);
    await getRoundResultForAgent(db, ROUND_ID, STX_ADDRESS);

    expect(stmt.bind).toHaveBeenCalledWith(ROUND_ID, STX_ADDRESS);
  });

  it("pnl_percent is null for a zero-volume agent result", async () => {
    const zeroVolumeRow = { ...RESULT_ROW_RAW, volume_usd: 0, pnl_percent: null };
    const { db } = createReadMockD1([], zeroVolumeRow);
    const result = await getRoundResultForAgent(db, ROUND_ID, STX_ADDRESS);

    expect(result?.pnl_percent).toBeNull();
    expect(result?.volume_usd).toBe(0);
  });
});

// ── getRoundRewards ───────────────────────────────────────────────────────────

describe("getRoundRewards", () => {
  it("returns all rewards for a round", async () => {
    const rewards = [
      { ...REWARD_ROW, category: "overall_pnl" },
      { ...REWARD_ROW, category: "volume" },
      { ...REWARD_ROW, category: "return" },
    ];
    const { db } = createReadMockD1(rewards);
    const results = await getRoundRewards(db, ROUND_ID);

    expect(results).toHaveLength(3);
  });

  it("maps CompetitionReward fields correctly", async () => {
    const { db } = createReadMockD1([REWARD_ROW]);
    const results = await getRoundRewards(db, ROUND_ID);
    const r = results[0];

    expect(r.round_id).toBe(ROUND_ID);
    expect(r.category).toBe("overall_pnl");
    expect(r.stx_address).toBe(STX_ADDRESS);
    expect(r.status).toBe("pending");
    expect(r.payout_txid).toBeNull();
  });

  it("returns [] when no rewards exist for the round", async () => {
    const { db } = createReadMockD1([]);
    const results = await getRoundRewards(db, ROUND_ID);

    expect(results).toEqual([]);
  });

  it("SQL orders by category ASC", async () => {
    const { db } = createReadMockD1([]);
    await getRoundRewards(db, ROUND_ID);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY category ASC");
  });
});

// ── getLatestFinalizedRoundResultForAgent ─────────────────────────────────────

describe("getLatestFinalizedRoundResultForAgent", () => {
  it("returns the most recent finalized round result for an agent", async () => {
    const { db } = createReadMockD1([], RESULT_ROW_RAW);
    const result = await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    expect(result).not.toBeNull();
    expect(result?.stx_address).toBe(STX_ADDRESS);
  });

  it("returns null when agent has no placements in any finalized round", async () => {
    const { db } = createReadMockD1([], null);
    const result = await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    expect(result).toBeNull();
  });

  it("parseResultJson is invoked — result_json is an object, not a string", async () => {
    const { db } = createReadMockD1([], RESULT_ROW_RAW);
    const result = await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    expect(typeof result?.result_json).toBe("object");
    expect(result?.result_json.source_counts).toBeDefined();
  });

  it("SQL JOINs competition_rounds and filters by visible statuses", async () => {
    const { db } = createReadMockD1([], null);
    await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("JOIN competition_rounds");
    expect(sql).toContain("status IN");
    expect(sql).toContain("'finalized'");
  });

  it("SQL orders by cr.starts_at DESC and limits to 1 row (most recent)", async () => {
    const { db } = createReadMockD1([], null);
    await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY cr.starts_at DESC");
    expect(sql).toContain("LIMIT 1");
  });

  it("SQL binds stxAddress to ?1", async () => {
    const { db, stmt } = createReadMockD1([], null);
    await getLatestFinalizedRoundResultForAgent(db, STX_ADDRESS);

    expect(stmt.bind).toHaveBeenCalledWith(STX_ADDRESS);
  });
});
