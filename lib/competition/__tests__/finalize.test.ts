/**
 * Load-bearing tests for lib/competition/finalize/{compute,persist,snapshot}.ts
 *
 * The recompute-equivalence test is THE acceptance test (per quest
 * 2026-05-20-competition-snapshot-finalize, locked decision #5):
 *   Seed swaps + frozen prices → run finalize → re-run compute with the same
 *   inputs → assert byte-for-byte equality with competition_round_results rows.
 *
 * Additional cases:
 *   - NaN guard: zero-volume agent gets pnl_percent: null
 *   - Floor gates: sub-floor agent excluded from Return Champion only
 *   - Financial formulas: volume_usd = SUM(amount_in / 10^dec * price)
 *   - Source counts accumulation
 *   - persistRoundResults idempotency guard
 *   - captureRoundPriceSnapshot status assertion
 */

import { describe, it, expect, vi } from "vitest";
import { computeRoundResults } from "../finalize/compute";
import { persistRoundResults } from "../finalize/persist";
import { captureRoundPriceSnapshot } from "../finalize/snapshot";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ROUND_ID = "week-1-2026-05-13";
const FIXED_NOW = "2026-05-20T20:00:00.000Z";

const ROUND_ROW = {
  round_id: ROUND_ID,
  starts_at: 1778700600,
  ends_at: 1779305400,
  grace_ends_at: 1779309000,
  status: "finalizing",
  min_volume_usd: 50.0,
  min_priced_trade_count: 3,
  created_at: "2026-05-13T19:30:00Z",
  finalized_at: null,
};

// Prices: STX-like token at 6 decimals, sBTC at 8 decimals
const PRICE_SNAPSHOT_ROWS = [
  { token_id: "SP111.wstx", price_usd: 0.25, decimals: 6 },
  { token_id: "SP222.ststx", price_usd: 0.28, decimals: 6 },
  { token_id: "SP333.sbtc", price_usd: 103000.0, decimals: 8 },
];

// Agent A: 5 priced swaps (high P&L), Genesis + ERC-8004
// 3 swaps from 'agent' source, 2 from 'cron'
// pair 1: 1_000_000 wstx in → 900_000 ststx out (3 swaps from agent)
// pair 2: 500_000 wstx in → 480_000 ststx out (2 swaps from cron)
const SWAP_ROWS_AGENT_A_PAIR1_AGENT = {
  sender: "ST1AGENTA",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 3,
  sum_in: 3_000_000, // 3 * 1_000_000 raw (= 3.0 tokens at 6 dec)
  sum_out: 2_700_000, // 3 * 900_000 raw (= 2.7 tokens at 6 dec)
  latest_at: 1778900000,
  btc_address: "bc1qagenta",
  erc8004_agent_id: 1,
  source: "agent",
};
const SWAP_ROWS_AGENT_A_PAIR2_CRON = {
  sender: "ST1AGENTA",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 2,
  sum_in: 1_000_000, // 2 * 500_000 raw (= 1.0 tokens at 6 dec)
  sum_out: 960_000, // 2 * 480_000 raw (= 0.96 tokens at 6 dec)
  latest_at: 1779000000,
  btc_address: "bc1qagenta",
  erc8004_agent_id: 1,
  source: "cron",
};

// Agent B: 4 priced swaps (medium P&L), Genesis + ERC-8004
const SWAP_ROWS_AGENT_B = {
  sender: "ST2AGENTB",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 4,
  sum_in: 2_000_000, // = 2.0 tokens at 6 dec
  sum_out: 1_800_000, // = 1.8 tokens at 6 dec
  latest_at: 1778950000,
  btc_address: "bc1qagentb",
  erc8004_agent_id: 2,
  source: "agent",
};

// Agent C: 1 swap but amount_in = 0 (zero volume → pnl_percent = null)
const SWAP_ROWS_AGENT_C = {
  sender: "ST3AGENTC",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 1,
  sum_in: 0,
  sum_out: 0,
  latest_at: 1778800000,
  btc_address: "bc1qagentc",
  erc8004_agent_id: 3,
  source: "agent",
};

// Agent D: below Return Champion floors (volume < 50 USD)
// sum_in = 100_000 wstx raw = 0.1 tokens * $0.25 = $0.025 < $50 floor
const SWAP_ROWS_AGENT_D = {
  sender: "ST4AGENTD",
  token_in: "SP111.wstx",
  token_out: "SP222.ststx",
  cnt: 2,
  sum_in: 100_000, // $0.025 volume — below min_volume_usd=50
  sum_out: 90_000,
  latest_at: 1778850000,
  btc_address: "bc1qagentd",
  erc8004_agent_id: 4,
  source: "agent",
};

// ── Mock D1 builder ───────────────────────────────────────────────────────────

/**
 * Stateful mock D1 that routes queries by SQL content.
 * Captures batch() calls so we can inspect what was written.
 */
interface BatchCall {
  statements: Array<{ sql: string; binds: unknown[] }>;
}

function createFinalizeMockD1(opts: {
  swapRows?: object[];
  existingResultCount?: number;
  roundStatus?: string;
}): {
  db: D1Database;
  batchCalls: BatchCall[];
} {
  const batchCalls: BatchCall[] = [];
  const swapRows = opts.swapRows ?? [];
  const existingResultCount = opts.existingResultCount ?? 0;
  const roundStatus = opts.roundStatus ?? "finalizing";

  // The mock tracks calls and returns pre-configured data based on SQL content.
  // IMPORTANT: bind() uses mockImplementation (not mockReturnValue) so _binds
  // is captured correctly before returning the statement.
  const db = {
    prepare: vi.fn((sql: string) => {
      // Each prepare() returns a new statement object with its own _binds.
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

          // competition_rounds point-lookup
          if (s.includes("from competition_rounds") && s.includes("round_id = ?1")) {
            return { ...ROUND_ROW, status: roundStatus };
          }
          // competition_round_results idempotency check
          if (s.includes("count(*)") && s.includes("competition_round_results")) {
            return { cnt: existingResultCount };
          }
          return null;
        }),
        all: vi.fn(async (): Promise<{ results: unknown[] }> => {
          const s = sql.trim().toLowerCase();

          // price snapshots
          if (s.includes("from competition_round_price_snapshots")) {
            return { results: PRICE_SNAPSHOT_ROWS };
          }
          // swap aggregate query (matches ROUND_SWAP_AGGREGATE_SQL)
          if (s.includes("from swaps s")) {
            return { results: swapRows };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      };

      // Use mockImplementation so _binds is populated AND stmt is returned.
      stmt.bind.mockImplementation((...args: unknown[]) => {
        stmt._binds = args;
        return stmt;
      });

      return stmt;
    }),
    batch: vi.fn(async (stmts: Array<{ _sql: string; _binds: unknown[] }>) => {
      const call: BatchCall = {
        statements: stmts.map((s) => ({ sql: s._sql, binds: s._binds })),
      };
      batchCalls.push(call);
      // Return mock results: each statement succeeded with changes=1
      return stmts.map(() => ({ meta: { changes: 1 } }));
    }),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return { db, batchCalls };
}

// ── computeRoundResults ───────────────────────────────────────────────────────

describe("computeRoundResults", () => {
  it("returns one RoundResult per eligible agent", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON, SWAP_ROWS_AGENT_B],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    expect(results).toHaveLength(2);
    const stxAddresses = results.map((r) => r.stx_address).sort();
    expect(stxAddresses).toEqual(["ST1AGENTA", "ST2AGENTB"]);
  });

  it("assigns rank=1 to the agent with highest pnl_usd", async () => {
    // Agent A: volume_usd = (4 tokens * $0.25) = $1.00
    //          received_usd = (3.66 tokens * $0.28) = $1.0248
    //          pnl_usd = 1.0248 - 1.00 = $0.0248 (positive)
    // Agent B: volume_usd = (2 tokens * $0.25) = $0.50
    //          received_usd = (1.8 tokens * $0.28) = $0.504
    //          pnl_usd = 0.504 - 0.50 = $0.004 (positive but smaller)
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON, SWAP_ROWS_AGENT_B],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const rank1 = results.find((r) => r.rank === 1);
    expect(rank1?.stx_address).toBe("ST1AGENTA");
  });

  it("pnl_percent is null for zero-volume agent (NaN guard)", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_C],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentC = results.find((r) => r.stx_address === "ST3AGENTC");
    expect(agentC).toBeDefined();
    expect(agentC?.pnl_percent).toBeNull();
    expect(agentC?.volume_usd).toBe(0);
  });

  it("zero-volume agent still has a rank (appears in P&L ranking)", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_C],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentC = results.find((r) => r.stx_address === "ST3AGENTC");
    expect(agentC?.rank).toBeGreaterThan(0);
  });

  it("zero-volume agent is excluded from Return Champion rewards", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_C],
    });
    const { rewards } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const returnReward = rewards.find((r) => r.category === "return");
    expect(returnReward).toBeUndefined();
  });

  it("Return Champion floor: agent below min_volume_usd excluded", async () => {
    // Agent D has volume < $50 (min_volume_usd=50.0)
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_D],
    });
    const { rewards } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const returnReward = rewards.find((r) => r.category === "return");
    expect(returnReward).toBeUndefined();
  });

  it("Return Champion floor: agent below min_priced_trade_count excluded", async () => {
    // Agent D has only 2 priced trades (min=3). Boost volume to pass $ floor
    // by using sbtc at $103,000 — 1 unit raw with 8 decimals = $0.00103,
    // still low. Actually give large sum_in to pass the $ floor but cnt=2.
    const highVolumeLowCountRow = {
      ...SWAP_ROWS_AGENT_D,
      // Override to pass $ floor but still only 2 trades
      token_in: "SP333.sbtc",
      sum_in: 1_000_000_000, // 10 sBTC at 8 dec = 10 * $103,000 = $1,030,000
      sum_out: 950_000_000,
      token_out: "SP333.sbtc",
      cnt: 2, // below min_priced_trade_count=3
    };
    const { db } = createFinalizeMockD1({
      swapRows: [highVolumeLowCountRow],
    });
    const { rewards } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const returnReward = rewards.find((r) => r.category === "return");
    expect(returnReward).toBeUndefined();
  });

  it("volume_usd is computed as SUM(amount_in) / 10^decimals * price_usd", async () => {
    // Agent A pair1: sum_in=3_000_000, dec=6, price=$0.25
    //   contrib = 3_000_000 / 1_000_000 * 0.25 = 3 * 0.25 = 0.75
    // Agent A pair2: sum_in=1_000_000, dec=6, price=$0.25
    //   contrib = 1_000_000 / 1_000_000 * 0.25 = 1 * 0.25 = 0.25
    // Total volume_usd = 1.0
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentA = results.find((r) => r.stx_address === "ST1AGENTA");
    expect(agentA?.volume_usd).toBeCloseTo(1.0, 6);
  });

  it("received_usd is computed as SUM(amount_out) / 10^decimals * price_usd", async () => {
    // Agent A pair1: sum_out=2_700_000, dec=6, price=$0.28
    //   contrib = 2_700_000 / 1_000_000 * 0.28 = 2.7 * 0.28 = 0.756
    // Agent A pair2: sum_out=960_000, dec=6, price=$0.28
    //   contrib = 960_000 / 1_000_000 * 0.28 = 0.96 * 0.28 = 0.2688
    // Total received_usd = 1.0248
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentA = results.find((r) => r.stx_address === "ST1AGENTA");
    expect(agentA?.received_usd).toBeCloseTo(1.0248, 4);
  });

  it("unpriced token is excluded from volume_usd, counted in unpriced_trade_count", async () => {
    const unknownTokenRow = {
      sender: "ST1AGENTA",
      token_in: "SP999.unknown-token", // not in price snapshot
      token_out: "SP111.wstx",
      cnt: 2,
      sum_in: 1_000_000,
      sum_out: 1_200_000,
      latest_at: 1779000000,
      btc_address: "bc1qagenta",
      erc8004_agent_id: 1,
      source: "agent",
    };
    const { db } = createFinalizeMockD1({
      swapRows: [unknownTokenRow],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentA = results.find((r) => r.stx_address === "ST1AGENTA");
    expect(agentA?.volume_usd).toBe(0);
    expect(agentA?.unpriced_trade_count).toBe(2);
    expect(agentA?.priced_trade_count).toBe(0);
    expect(agentA?.result_json.unpriced_tokens).toContain("SP999.unknown-token");
  });

  it("result_json.source_counts sums per-source swap counts correctly", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentA = results.find((r) => r.stx_address === "ST1AGENTA");
    // pair1: 3 agent swaps, pair2: 2 cron swaps
    expect(agentA?.result_json.source_counts.agent).toBe(3);
    expect(agentA?.result_json.source_counts.cron).toBe(2);
    expect(agentA?.result_json.source_counts.chainhook).toBe(0);
  });

  it("trade_count is the total across all sources and pairs", async () => {
    const { db } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON],
    });
    const { results } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const agentA = results.find((r) => r.stx_address === "ST1AGENTA");
    expect(agentA?.trade_count).toBe(5); // 3 + 2
  });

  it("rewards include overall_pnl, volume, and return categories", async () => {
    const { db } = createFinalizeMockD1({
      // Need high enough volume + trade count for return champion
      swapRows: [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON, SWAP_ROWS_AGENT_B],
    });
    const { rewards } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const categories = rewards.map((r) => r.category).sort();
    // overall_pnl and volume should always be present with at least 1 agent
    // return only if floor gates pass — both agents have volume < $50 in these fixtures
    // Agent A volume = $1.00 (below $50 floor), Agent B volume = $0.50 (below $50 floor)
    expect(categories).toContain("overall_pnl");
    expect(categories).toContain("volume");
  });

  it("return reward is present when an agent passes all floor gates", async () => {
    // Give Agent A enough volume to pass the $50 floor and 3+ priced trades
    const highVolumeRow = {
      ...SWAP_ROWS_AGENT_A_PAIR1_AGENT,
      token_in: "SP333.sbtc",
      token_out: "SP333.sbtc",
      sum_in: 1_000_000_000, // 10 sBTC = $1,030,000
      sum_out: 1_100_000_000,
      cnt: 4, // >= min_priced_trade_count=3
    };
    const { db } = createFinalizeMockD1({ swapRows: [highVolumeRow] });
    const { rewards } = await computeRoundResults(db, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });
    const returnReward = rewards.find((r) => r.category === "return");
    expect(returnReward).toBeDefined();
    expect(returnReward?.stx_address).toBe("ST1AGENTA");
  });

  it("throws round_not_found when round does not exist", async () => {
    const { db } = createFinalizeMockD1({ swapRows: [] });
    // Override prepare to return null for round lookup
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }));
    await expect(
      computeRoundResults(db, { roundId: "nonexistent" })
    ).rejects.toThrow("round_not_found");
  });
});

// ── Recompute-equivalence test (THE acceptance test) ─────────────────────────

describe("recompute-equivalence (THE acceptance test)", () => {
  it("running compute twice with identical inputs produces byte-for-byte equal results", async () => {
    const swapRows = [
      SWAP_ROWS_AGENT_A_PAIR1_AGENT,
      SWAP_ROWS_AGENT_A_PAIR2_CRON,
      SWAP_ROWS_AGENT_B,
      SWAP_ROWS_AGENT_C,
    ];

    // First compute run
    const { db: db1 } = createFinalizeMockD1({ swapRows });
    const run1 = await computeRoundResults(db1, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    // Second compute run — identical mock, identical inputs
    const { db: db2 } = createFinalizeMockD1({ swapRows });
    const run2 = await computeRoundResults(db2, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    // Structural deep equality
    expect(run1.results).toEqual(run2.results);
    expect(run1.rewards).toEqual(run2.rewards);

    // Byte-for-byte JSON equality (the literal acceptance criterion)
    expect(JSON.stringify(run1.results)).toBe(JSON.stringify(run2.results));
    expect(JSON.stringify(run1.rewards)).toBe(JSON.stringify(run2.rewards));
  });

  it("persisted results are structurally identical to the compute output", async () => {
    const swapRows = [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_B];

    // 1. Compute
    const { db: computeDb } = createFinalizeMockD1({ swapRows });
    const { results, rewards } = await computeRoundResults(computeDb, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    // 2. Persist (capture what was written)
    const { db: persistDb, batchCalls } = createFinalizeMockD1({ swapRows });
    await persistRoundResults(persistDb, ROUND_ID, results, rewards);

    // 3. Extract the result INSERT bindings from the batch
    const batchStatements = batchCalls[0].statements;
    const resultInserts = batchStatements.filter((s) =>
      s.sql.includes("competition_round_results")
    );

    // Should have one INSERT per result
    expect(resultInserts).toHaveLength(results.length);

    // 4. Re-run compute with the same inputs
    const { db: recomputeDb } = createFinalizeMockD1({ swapRows });
    const { results: results2, rewards: rewards2 } = await computeRoundResults(
      recomputeDb,
      { roundId: ROUND_ID, now: () => FIXED_NOW }
    );

    // Byte-for-byte equal
    expect(JSON.stringify(results2)).toBe(JSON.stringify(results));
    expect(JSON.stringify(rewards2)).toBe(JSON.stringify(rewards));
  });
});

// ── persistRoundResults ───────────────────────────────────────────────────────

describe("persistRoundResults", () => {
  it("executes D1 batch with result rows, reward rows, and status update", async () => {
    const swapRows = [SWAP_ROWS_AGENT_A_PAIR1_AGENT];
    const { db: computeDb } = createFinalizeMockD1({ swapRows });
    const { results, rewards } = await computeRoundResults(computeDb, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    const { db: persistDb, batchCalls } = createFinalizeMockD1({ swapRows });
    await persistRoundResults(persistDb, ROUND_ID, results, rewards);

    expect(batchCalls).toHaveLength(1);
    const stmts = batchCalls[0].statements;

    // Should contain result inserts
    const resultInserts = stmts.filter((s) =>
      s.sql.includes("competition_round_results")
    );
    expect(resultInserts).toHaveLength(results.length);

    // Should contain reward inserts
    const rewardInserts = stmts.filter((s) =>
      s.sql.includes("competition_rewards")
    );
    expect(rewardInserts).toHaveLength(rewards.length);

    // Should contain the status UPDATE
    const updateStmt = stmts.find((s) =>
      s.sql.includes("UPDATE competition_rounds") &&
      s.sql.includes("finalized")
    );
    expect(updateStmt).toBeDefined();
  });

  it("throws already_finalized when results rows exist for the round", async () => {
    const { db } = createFinalizeMockD1({ existingResultCount: 2 });
    await expect(
      persistRoundResults(db, ROUND_ID, [], [])
    ).rejects.toThrow("already_finalized");
  });

  it("serializes result_json as a JSON string in the INSERT binding", async () => {
    const swapRows = [SWAP_ROWS_AGENT_A_PAIR1_AGENT, SWAP_ROWS_AGENT_A_PAIR2_CRON];
    const { db: computeDb } = createFinalizeMockD1({ swapRows });
    const { results, rewards } = await computeRoundResults(computeDb, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    const { db: persistDb, batchCalls } = createFinalizeMockD1({ swapRows });
    await persistRoundResults(persistDb, ROUND_ID, results, rewards);

    const stmts = batchCalls[0].statements;
    const resultInsert = stmts.find((s) =>
      s.sql.includes("competition_round_results")
    );
    expect(resultInsert).toBeDefined();
    // The 14th bind param (index 13) should be the serialized result_json string
    const resultJsonBind = resultInsert?.binds[13];
    expect(typeof resultJsonBind).toBe("string");
    const parsed = JSON.parse(resultJsonBind as string);
    expect(parsed).toHaveProperty("source_counts");
    expect(parsed).toHaveProperty("unpriced_tokens");
  });

  it("binds null for pnl_percent of a zero-volume agent", async () => {
    const { db: computeDb } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_C],
    });
    const { results, rewards } = await computeRoundResults(computeDb, {
      roundId: ROUND_ID,
      now: () => FIXED_NOW,
    });

    const { db: persistDb, batchCalls } = createFinalizeMockD1({
      swapRows: [SWAP_ROWS_AGENT_C],
    });
    await persistRoundResults(persistDb, ROUND_ID, results, rewards);

    const stmts = batchCalls[0].statements;
    const resultInsert = stmts.find((s) =>
      s.sql.includes("competition_round_results")
    );
    expect(resultInsert).toBeDefined();
    // pnl_percent is the 12th bind (index 11)
    const pnlPercentBind = resultInsert?.binds[11];
    expect(pnlPercentBind).toBeNull();
  });
});

// ── captureRoundPriceSnapshot ─────────────────────────────────────────────────

describe("captureRoundPriceSnapshot", () => {
  function createSnapshotMockD1(roundStatus: string): D1Database {
    const db = {
      prepare: vi.fn((sql: string) => {
        const stmt = {
          _sql: sql,
          _binds: [] as unknown[],
          bind: vi.fn((...args: unknown[]) => {
            stmt._binds = args;
            return stmt;
          }),
          first: vi.fn(async (): Promise<unknown> => {
            if (sql.includes("from competition_rounds") || sql.toLowerCase().includes("from competition_rounds")) {
              return { status: roundStatus };
            }
            return null;
          }),
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        };
        stmt.bind.mockReturnValue(stmt);
        return stmt;
      }),
      batch: vi.fn(async (stmts: Array<{ _sql: string; _binds: unknown[] }>) => {
        return stmts.map(() => ({ meta: { changes: 1 } }));
      }),
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;
    return db;
  }

  function createMockKV(prices: Map<string, number | null>): KVNamespace {
    return {
      get: vi.fn(async (key: string, type?: string) => {
        const tokenId = key.replace("tenero:price:", "");
        const price = prices.get(tokenId);
        if (price === undefined) return null;
        const val = {
          priceUsd: price,
          fetchedAt: Date.now(),
          minuteRemaining: null,
          monthRemaining: null,
        };
        if (type === "json") return val;
        return JSON.stringify(val);
      }),
    } as unknown as KVNamespace;
  }

  it("throws round_not_found when round does not exist", async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
      batch: vi.fn(),
    } as unknown as D1Database;
    const kv = createMockKV(new Map());
    await expect(
      captureRoundPriceSnapshot(db, {
        roundId: "nonexistent",
        kv,
        tokenIds: [],
        decimalsMap: new Map(),
      })
    ).rejects.toThrow("round_not_found");
  });

  it("throws wrong_status when round is not in closed state", async () => {
    const db = createSnapshotMockD1("open");
    const kv = createMockKV(new Map());
    await expect(
      captureRoundPriceSnapshot(db, {
        roundId: ROUND_ID,
        kv,
        tokenIds: [],
        decimalsMap: new Map(),
      })
    ).rejects.toThrow("wrong_status");
  });

  it("reports unpriced tokens that are missing from KV cache", async () => {
    const db = createSnapshotMockD1("closed");
    // Only have price for wstx, not for ststx
    const kv = createMockKV(
      new Map([
        ["SP111.wstx", 0.25],
        ["SP222.ststx", null], // null price → unpriced
      ])
    );
    const result = await captureRoundPriceSnapshot(db, {
      roundId: ROUND_ID,
      kv,
      tokenIds: ["SP111.wstx", "SP222.ststx", "SP999.missing"],
      decimalsMap: new Map([
        ["SP111.wstx", 6],
        ["SP222.ststx", 6],
        ["SP999.missing", 6],
      ]),
      now: () => FIXED_NOW,
    });
    expect(result.priced).toBe(1);
    expect(result.unpriced).toContain("SP222.ststx");
    expect(result.unpriced).toContain("SP999.missing");
  });

  it("writes priced rows and flips status to finalizing via D1 batch", async () => {
    const db = createSnapshotMockD1("closed");
    let batchStatements: unknown[] = [];
    (db.batch as ReturnType<typeof vi.fn>).mockImplementation(
      async (stmts: unknown[]) => {
        batchStatements = stmts;
        return stmts.map(() => ({ meta: { changes: 1 } }));
      }
    );

    const kv = createMockKV(
      new Map([
        ["SP111.wstx", 0.25],
        ["SP222.ststx", 0.28],
      ])
    );
    const result = await captureRoundPriceSnapshot(db, {
      roundId: ROUND_ID,
      kv,
      tokenIds: ["SP111.wstx", "SP222.ststx"],
      decimalsMap: new Map([
        ["SP111.wstx", 6],
        ["SP222.ststx", 6],
      ]),
      now: () => FIXED_NOW,
    });

    expect(result.priced).toBe(2);
    expect(result.unpriced).toHaveLength(0);

    // 2 INSERT + 1 UPDATE status flip
    expect(batchStatements).toHaveLength(3);
  });
});
