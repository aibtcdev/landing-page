/**
 * Unit tests for `lib/competition/stats.ts`.
 *
 * Asserts the SQL shape + bind contract for `getSwapStats`,
 * `recordSwapInsert`, and `rebuildSwapStats`. The shape is pinned
 * here so a schema rename or column reorder is caught in CI before
 * it ships to production.
 */

import { describe, it, expect, vi } from "vitest";
import { getSwapStats, recordSwapInsert, rebuildSwapStats } from "../stats";

const STX_ADDRESS = "SP1TESTADDRESS1234";
const BURN_BLOCK_TIME = 1762547890;

interface CapturedRun {
  sql: string;
  binds: unknown[];
}

function createMockD1(opts?: {
  firstResult?: unknown;
  runError?: Error;
}): { db: D1Database; runs: CapturedRun[] } {
  const runs: CapturedRun[] = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        first: vi.fn(async () => {
          runs.push({ sql, binds });
          return opts?.firstResult ?? null;
        }),
        run: vi.fn(async () => {
          runs.push({ sql, binds });
          if (opts?.runError) throw opts.runError;
          return { meta: { changes: 1 } };
        }),
      })),
      // For statements without bind() (rebuildSwapStats DELETE)
      first: vi.fn(async () => {
        runs.push({ sql, binds: [] });
        return null;
      }),
      run: vi.fn(async () => {
        runs.push({ sql, binds: [] });
        return { meta: { changes: 1 } };
      }),
    })),
  } as unknown as D1Database;
  return { db, runs };
}

// ── getSwapStats ─────────────────────────────────────────────────────────────

describe("getSwapStats", () => {
  it("issues a point-lookup on agent_swap_stats keyed by stx_address", async () => {
    const { db, runs } = createMockD1({
      firstResult: {
        stx_address: STX_ADDRESS,
        trade_count: 12,
        verified_count: 10,
        first_trade_at: 1700000000,
        last_trade_at: 1762547890,
        updated_at: "2026-05-20T00:00:00.000Z",
      },
    });

    const row = await getSwapStats(db, STX_ADDRESS);

    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("FROM agent_swap_stats");
    expect(runs[0].sql).toContain("WHERE stx_address = ?1");
    expect(runs[0].binds).toEqual([STX_ADDRESS]);
    expect(row?.trade_count).toBe(12);
    expect(row?.verified_count).toBe(10);
  });

  it("returns null when the sender has no stats row", async () => {
    const { db } = createMockD1({ firstResult: null });
    const row = await getSwapStats(db, STX_ADDRESS);
    expect(row).toBeNull();
  });
});

// ── recordSwapInsert ─────────────────────────────────────────────────────────

describe("recordSwapInsert", () => {
  it("INSERTs with trade_count=1 + ON CONFLICT bumps counters monotonically", async () => {
    const { db, runs } = createMockD1();
    await recordSwapInsert(db, STX_ADDRESS, BURN_BLOCK_TIME, "success");

    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("INSERT INTO agent_swap_stats");
    expect(runs[0].sql).toContain("ON CONFLICT(stx_address) DO UPDATE SET");
    expect(runs[0].sql).toContain("trade_count    = trade_count + 1");
    // verified_delta is the second bind (= 1 for success).
    expect(runs[0].binds[0]).toBe(STX_ADDRESS);
    expect(runs[0].binds[1]).toBe(1);
    expect(runs[0].binds[2]).toBe(BURN_BLOCK_TIME);
  });

  it("does NOT bump verified_count when tx_status is not 'success'", async () => {
    const { db, runs } = createMockD1();
    await recordSwapInsert(db, STX_ADDRESS, BURN_BLOCK_TIME, "abort_by_response");
    // verified_delta is the second bind (= 0 for non-success).
    expect(runs[0].binds[1]).toBe(0);
  });

  it("uses min()/max() so first/last_trade_at stay monotonic against clock skew", async () => {
    const { db, runs } = createMockD1();
    await recordSwapInsert(db, STX_ADDRESS, BURN_BLOCK_TIME, "success");
    expect(runs[0].sql).toMatch(/first_trade_at\s*=\s*min\s*\(/);
    expect(runs[0].sql).toMatch(/last_trade_at\s*=\s*max\s*\(/);
  });

  it("swallows D1 errors so a stats failure never breaks swap persistence", async () => {
    const { db } = createMockD1({
      runError: new Error("FOREIGN KEY constraint failed"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordSwapInsert(db, STX_ADDRESS, BURN_BLOCK_TIME, "success")
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[agent-swap-stats]")
    );
    warnSpy.mockRestore();
  });
});

// ── rebuildSwapStats ─────────────────────────────────────────────────────────

describe("rebuildSwapStats", () => {
  it("DELETEs then re-INSERTs from a swaps GROUP BY scan", async () => {
    const { db, runs } = createMockD1();
    await rebuildSwapStats(db);

    expect(runs).toHaveLength(2);
    expect(runs[0].sql).toContain("DELETE FROM agent_swap_stats");
    expect(runs[1].sql).toContain("INSERT INTO agent_swap_stats");
    expect(runs[1].sql).toContain("FROM swaps");
    expect(runs[1].sql).toContain("GROUP BY sender");
  });
});
