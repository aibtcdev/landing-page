/**
 * Tests for lib/competition/d1-reads.ts
 *
 * Phase 3.1 PR-A — read routes only. The verifier ships in PR-B.
 *
 * Verifies:
 *   - getCompetitionStatusFromD1: SQL shape, JOIN structure, mapping,
 *     unregistered-address synthesis (registered: false, do not 404)
 *   - listSwapsFromD1: keyset pagination over (burn_block_time, txid),
 *     ORDER BY DESC, LIMIT bindings, row mapping
 *   - countSwapsFromD1: COUNT(*) WHERE sender shape
 *   - encodeSwapsCursor / decodeSwapsCursor: round-trip + reject malformed
 *
 * Mock-D1 pattern matches lib/inbox/__tests__/d1-reads.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  getCompetitionStatusFromD1,
  listSwapsFromD1,
  countSwapsFromD1,
  encodeSwapsCursor,
  decodeSwapsCursor,
} from "../d1-reads";

// ── D1 mock helpers ──────────────────────────────────────────────────────────

function createPreparedStatement<T = unknown>(
  rows: T[] = [],
  firstResult: T | null = null
) {
  const stmt = {
    bind: vi.fn(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn().mockResolvedValue({ results: rows }),
    raw: vi.fn(),
  };
  stmt.bind.mockReturnValue(stmt);
  return stmt;
}

function createMockD1<T = unknown>(
  rows: T[] = [],
  firstResult: T | null = null
): { db: D1Database; stmt: ReturnType<typeof createPreparedStatement<T>> } {
  const stmt = createPreparedStatement<T>(rows, firstResult);
  const db = {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
  return { db, stmt };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STX_ADDRESS = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";

const STATUS_ROW = {
  address: STX_ADDRESS,
  agent_id: 42,
  registered: 1,
  trade_count: 12,
  verified_trade_count: 10,
  first_trade_at: 1762547890,
  last_trade_at: 1762634290,
};

const SWAP_ROW = {
  txid: "0x46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4",
  sender: STX_ADDRESS,
  contract_id: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
  function_name: "swap-x-for-y",
  token_in: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.wstx",
  amount_in: 1000000,
  token_out: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token",
  amount_out: 859839,
  burn_block_time: 1762547890,
  tx_status: "success",
  source: "agent",
  scored_value: null,
  scored_at: null,
};

// ── getCompetitionStatusFromD1 ───────────────────────────────────────────────

describe("getCompetitionStatusFromD1", () => {
  it("issues a JOIN over registered_wallets + agents + agent_swap_stats with sender filter (P3B PR 2)", async () => {
    const { db, stmt } = createMockD1([], STATUS_ROW);
    await getCompetitionStatusFromD1(db, STX_ADDRESS);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM registered_wallets rw");
    expect(sql).toContain("JOIN agents a ON a.stx_address = rw.stx_address");
    // P3B PR 2: replaces the per-request `LEFT JOIN swaps + COUNT/SUM/MIN/MAX`
    // scan with an O(1) lookup on the maintained-counter table.
    expect(sql).toContain("LEFT JOIN agent_swap_stats s ON s.stx_address = rw.stx_address");
    expect(sql).not.toContain("LEFT JOIN swaps");
    expect(sql).toContain("WHERE rw.stx_address = ?1");
    // No GROUP BY needed now — the source table is one-row-per-sender.
    expect(sql).not.toContain("GROUP BY");

    expect(stmt.bind.mock.calls[0][0]).toBe(STX_ADDRESS);
  });

  it("reads pre-aggregated verified_count from agent_swap_stats instead of SUM(CASE...)", async () => {
    const { db } = createMockD1([], STATUS_ROW);
    await getCompetitionStatusFromD1(db, STX_ADDRESS);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // No SUM/COUNT/MIN/MAX over swaps any more — the helper writes them.
    expect(sql).not.toContain("SUM(CASE WHEN");
    expect(sql).not.toContain("COUNT(s.txid)");
    expect(sql).toContain("COALESCE(s.verified_count, 0)");
    expect(sql).toContain("COALESCE(s.trade_count, 0)");
  });

  it("maps a populated row to CompetitionStatusRow with registered=true", async () => {
    const { db } = createMockD1([], STATUS_ROW);
    const result = await getCompetitionStatusFromD1(db, STX_ADDRESS);

    expect(result).toEqual({
      address: STX_ADDRESS,
      agent_id: 42,
      registered: true,
      trade_count: 12,
      verified_trade_count: 10,
      first_trade_at: 1762547890,
      last_trade_at: 1762634290,
    });
  });

  it("returns registered=false synthesized row when address is not in registered_wallets (no 404)", async () => {
    const { db } = createMockD1([], null);
    const result = await getCompetitionStatusFromD1(db, STX_ADDRESS);

    expect(result).toEqual({
      address: STX_ADDRESS,
      agent_id: null,
      registered: false,
      trade_count: 0,
      verified_trade_count: 0,
      first_trade_at: null,
      last_trade_at: null,
    });
  });

  it("preserves null agent_id when the agent has not minted an ERC-8004 identity", async () => {
    const noIdentityRow = { ...STATUS_ROW, agent_id: null };
    const { db } = createMockD1([], noIdentityRow);
    const result = await getCompetitionStatusFromD1(db, STX_ADDRESS);
    expect(result.agent_id).toBeNull();
    expect(result.registered).toBe(true);
  });

  it("preserves null first/last trade times when the agent has zero swaps", async () => {
    const noTradesRow = {
      ...STATUS_ROW,
      trade_count: 0,
      verified_trade_count: 0,
      first_trade_at: null,
      last_trade_at: null,
    };
    const { db } = createMockD1([], noTradesRow);
    const result = await getCompetitionStatusFromD1(db, STX_ADDRESS);
    expect(result.trade_count).toBe(0);
    expect(result.first_trade_at).toBeNull();
    expect(result.last_trade_at).toBeNull();
  });
});

// ── listSwapsFromD1 ──────────────────────────────────────────────────────────

describe("listSwapsFromD1", () => {
  it("issues SELECT from swaps WHERE sender = ?1 ordered by burn_block_time DESC, txid DESC", async () => {
    const { db } = createMockD1([SWAP_ROW]);
    await listSwapsFromD1(db, STX_ADDRESS, 50, null);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM swaps");
    expect(sql).toContain("WHERE sender = ?1");
    expect(sql).toContain("ORDER BY burn_block_time DESC, txid DESC");
    expect(sql).toContain("LIMIT ?4");
  });

  it("binds (sender, null, null, limit) when no cursor is provided", async () => {
    const { db, stmt } = createMockD1([]);
    await listSwapsFromD1(db, STX_ADDRESS, 50, null);

    expect(stmt.bind).toHaveBeenCalledWith(STX_ADDRESS, null, null, 50);
  });

  it("binds (sender, cursor.t, cursor.x, limit) when a cursor is provided", async () => {
    const { db, stmt } = createMockD1([]);
    await listSwapsFromD1(db, STX_ADDRESS, 25, { t: 1762547890, x: "0xabc" });

    expect(stmt.bind).toHaveBeenCalledWith(STX_ADDRESS, 1762547890, "0xabc", 25);
  });

  it("uses keyset semantics so the cursor pair is strictly less-than (no duplicate row on repeat)", async () => {
    const { db } = createMockD1([]);
    await listSwapsFromD1(db, STX_ADDRESS, 50, null);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The lexicographic-less-than predicate; either explicit tuple form or
    // the equivalent OR-expansion must be present.
    const hasTupleForm =
      sql.includes("(burn_block_time, txid) < (?2, ?3)") ||
      (sql.includes("burn_block_time < ?2") &&
        sql.includes("burn_block_time = ?2 AND txid < ?3"));
    expect(hasTupleForm).toBe(true);
  });

  it("maps D1 swap rows to SwapRow shape", async () => {
    const { db } = createMockD1([SWAP_ROW]);
    const rows = await listSwapsFromD1(db, STX_ADDRESS, 50, null);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      txid: SWAP_ROW.txid,
      sender: SWAP_ROW.sender,
      contract_id: SWAP_ROW.contract_id,
      function_name: SWAP_ROW.function_name,
      token_in: SWAP_ROW.token_in,
      amount_in: SWAP_ROW.amount_in,
      token_out: SWAP_ROW.token_out,
      amount_out: SWAP_ROW.amount_out,
      burn_block_time: SWAP_ROW.burn_block_time,
      tx_status: SWAP_ROW.tx_status,
      source: "agent",
      scored_value: null,
      scored_at: null,
    });
  });

  it("returns [] when no rows match", async () => {
    const { db } = createMockD1([]);
    const rows = await listSwapsFromD1(db, STX_ADDRESS, 50, null);
    expect(rows).toHaveLength(0);
  });
});

// ── countSwapsFromD1 ─────────────────────────────────────────────────────────

describe("countSwapsFromD1", () => {
  it("reads trade_count from agent_swap_stats (P3B PR 2 — was SELECT COUNT(*) FROM swaps)", async () => {
    const { db, stmt } = createMockD1([], { cnt: 7 });
    const count = await countSwapsFromD1(db, STX_ADDRESS);

    expect(count).toBe(7);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // P3B PR 2: O(1) point-lookup on the maintained-counter table.
    // The prior `SELECT COUNT(*) FROM swaps` was the textbook D1
    // COUNT(*) anti-pattern called out in `feedback_d1_count_antipattern`.
    expect(sql).toContain("FROM agent_swap_stats");
    expect(sql).toContain("WHERE stx_address = ?1");
    expect(sql).not.toContain("FROM swaps");
    expect(sql).not.toContain("COUNT(*)");
    expect(stmt.bind.mock.calls[0][0]).toBe(STX_ADDRESS);
  });

  it("returns 0 when the agent has no agent_swap_stats row (never traded)", async () => {
    const { db } = createMockD1([], null);
    const count = await countSwapsFromD1(db, STX_ADDRESS);
    expect(count).toBe(0);
  });
});

// ── cursor codec ─────────────────────────────────────────────────────────────

describe("encodeSwapsCursor / decodeSwapsCursor", () => {
  it("round-trips a (t, x) pair", () => {
    const cursor = encodeSwapsCursor(1762547890, "0xabcdef");
    const decoded = decodeSwapsCursor(cursor);
    expect(decoded).toEqual({ t: 1762547890, x: "0xabcdef" });
  });

  it("produces a base64url-safe string (no +, /, =)", () => {
    const cursor = encodeSwapsCursor(1762547890, "0xabcdef");
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("throws when the cursor is not base64", () => {
    expect(() => decodeSwapsCursor("!!!not-base64!!!")).toThrow();
  });

  it("throws when the decoded payload has the wrong shape", () => {
    const bad = btoa(JSON.stringify({ foo: "bar" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeSwapsCursor(bad)).toThrow();
  });
});
