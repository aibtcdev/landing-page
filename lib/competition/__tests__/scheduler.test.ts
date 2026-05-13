/**
 * Tests for lib/competition/scheduler.ts
 *
 * Phase 3.1 PR-D — exercises the scheduler sweep's walk + dispatch
 * + cursor-persistence logic. Hiro fetch is injected; verify is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../verify", () => ({
  verifyAndPersistSwap: vi.fn(),
}));

import {
  runCompetitionScheduler,
  COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN,
} from "../scheduler";
import { verifyAndPersistSwap } from "../verify";
import type { Mock } from "vitest";

const POOL = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const ALLOWED_CONTRACT = `${POOL}.stableswap-stx-ststx-v-1-2`;
const ALLOWED_FN = "swap-x-for-y";

/**
 * D1 mock that handles both the registered_wallets page query and the
 * competition_state cursor get/set/delete operations. Cursor writes are
 * captured for assertion via the returned `cursorOps` object.
 */
function makeDb(
  rows: string[],
  opts: { initialCursor?: string | null } = {}
) {
  const cursorStore: { value: string | null } = {
    value: opts.initialCursor ?? null,
  };
  const cursorOps = {
    set: vi.fn<(cursor: string) => void>(),
    clear: vi.fn<() => void>(),
  };

  const prepare = vi.fn((sql: string) => {
    const trimmed = sql.trim();

    // cursor SELECT
    if (trimmed.startsWith("SELECT value FROM competition_state")) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(
            cursorStore.value !== null ? { value: cursorStore.value } : null
          ),
        }),
      };
    }
    // cursor UPSERT
    if (trimmed.startsWith("INSERT INTO competition_state")) {
      return {
        bind: vi.fn((_key: string, value: string) => ({
          run: vi.fn().mockImplementation(() => {
            cursorStore.value = value;
            cursorOps.set(value);
            return Promise.resolve({ meta: { changes: 1 } });
          }),
        })),
      };
    }
    // cursor DELETE
    if (trimmed.startsWith("DELETE FROM competition_state")) {
      return {
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation(() => {
            cursorStore.value = null;
            cursorOps.clear();
            return Promise.resolve({ meta: { changes: 1 } });
          }),
        }),
      };
    }
    // registered_wallets page query
    return {
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: rows.map((stx_address) => ({ stx_address })),
        }),
      }),
    };
  });

  const db = { prepare } as unknown as D1Database;
  return { db, cursorOps };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runCompetitionScheduler — walk + dispatch", () => {
  it("walks the address page, finds allowlisted txs, and submits them with source='cron'", async () => {
    const { db } = makeDb(["SP_ADDR_001"]);
    (verifyAndPersistSwap as Mock).mockResolvedValue({
      status: "verified",
      inserted: true,
      row: {},
    });

    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      {
        tx_id: "0xaaa",
        tx_type: "contract_call",
        contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN },
      },
    ]);

    const summary = await runCompetitionScheduler(
      { DB: db, HIRO_API_KEY: undefined },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary).toMatchObject({
      scanned: 1,
      found: 1,
      inserted: 1,
      alreadyKnown: 0,
      rejected: 0,
      pending: 0,
    });
    expect(verifyAndPersistSwap).toHaveBeenCalledTimes(1);
    expect((verifyAndPersistSwap as Mock).mock.calls[0][3]).toBe("cron");
  });

  it("skips off-allowlist contract calls without invoking verify (saves Hiro cost)", async () => {
    const { db } = makeDb(["SP_ADDR_001"]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      {
        tx_id: "0xaaa",
        tx_type: "contract_call",
        contract_call: { contract_id: "SP00000.unknown-pool", function_name: "swap" },
      },
    ]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.found).toBe(0);
    expect(verifyAndPersistSwap).not.toHaveBeenCalled();
  });

  it("skips non-contract_call txs without dispatch", async () => {
    const { db } = makeDb(["SP_ADDR_001"]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      { tx_id: "0xaaa", tx_type: "token_transfer" },
    ]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );
    expect(summary.found).toBe(0);
    expect(verifyAndPersistSwap).not.toHaveBeenCalled();
  });

  it("tallies inserted vs alreadyKnown vs pending vs rejected", async () => {
    const { db } = makeDb(["SP_ADDR_001"]);
    (verifyAndPersistSwap as Mock)
      .mockResolvedValueOnce({ status: "verified", inserted: true, row: {} })
      .mockResolvedValueOnce({ status: "verified", inserted: false, row: {} })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "rejected", code: "sender_not_registered", reason: "x" });

    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      { tx_id: "0xaaa", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
      { tx_id: "0xbbb", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
      { tx_id: "0xccc", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
      { tx_id: "0xddd", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
    ]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary).toMatchObject({
      scanned: 1,
      found: 4,
      inserted: 1,
      alreadyKnown: 1,
      pending: 1,
      rejected: 1,
    });
  });
});

describe("runCompetitionScheduler — cursor persistence", () => {
  it("persists the next cursor when the page is full (more addresses to walk)", async () => {
    const fullPage: string[] = Array.from(
      { length: COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN },
      (_, i) => `SP_ADDR_${String(i).padStart(3, "0")}`
    );
    const { db, cursorOps } = makeDb(fullPage);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.cursor).toBe(fullPage[fullPage.length - 1]);
    expect(cursorOps.set).toHaveBeenCalledWith(fullPage[fullPage.length - 1]);
    expect(cursorOps.clear).not.toHaveBeenCalled();
  });

  it("deletes the cursor when the page is partial (walk wrapped)", async () => {
    const { db, cursorOps } = makeDb(
      ["SP_ADDR_001", "SP_ADDR_002"],
      { initialCursor: "SP_PRIOR_CURSOR" }
    );
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.cursor).toBeNull();
    expect(cursorOps.clear).toHaveBeenCalled();
    expect(cursorOps.set).not.toHaveBeenCalled();
  });

  it("uses the cursor query branch when a cursor is present", async () => {
    const { db } = makeDb([], { initialCursor: "SP_LAST_RUN" });
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    const prepareCalls = (db.prepare as Mock).mock.calls.map((c) => c[0] as string);
    expect(prepareCalls.some((sql) => sql.includes("stx_address > ?1"))).toBe(true);
  });

  it("uses the head-of-list query branch when no cursor is present", async () => {
    const { db } = makeDb([]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    const prepareCalls = (db.prepare as Mock).mock.calls.map((c) => c[0] as string);
    const pageQueries = prepareCalls.filter((sql) => sql.includes("registered_wallets"));
    expect(pageQueries.every((sql) => !sql.includes("stx_address > ?"))).toBe(true);
  });
});

describe("runCompetitionScheduler — fault tolerance", () => {
  it("counts a verify throw as rejected and continues the sweep", async () => {
    const { db } = makeDb(["SP_ADDR_001"]);
    (verifyAndPersistSwap as Mock).mockRejectedValueOnce(new Error("boom"));

    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      { tx_id: "0xaaa", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
    ]);

    const summary = await runCompetitionScheduler(
      { DB: db },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.rejected).toBe(1);
    expect(summary.inserted).toBe(0);
  });
});
