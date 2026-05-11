/**
 * Tests for lib/competition/cron.ts
 *
 * Phase 3.1 PR-D — exercises the catch-up sweep's walk + dispatch
 * + cursor-persistence logic. Hiro fetch is injected; verify is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../verify", () => ({
  verifyAndPersistSwap: vi.fn(),
}));

import {
  runCompetitionCron,
  CRON_MAX_ADDRESSES_PER_RUN,
} from "../cron";
import { verifyAndPersistSwap } from "../verify";
import type { Mock } from "vitest";

const POOL = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const ALLOWED_CONTRACT = `${POOL}.stableswap-stx-ststx-v-1-2`;
const ALLOWED_FN = "swap-x-for-y";

function makeKv(initialCursor: string | null = null) {
  const store = new Map<string, string>();
  if (initialCursor) store.set("comp:cron:cursor", initialCursor);
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function makeDb(rows: string[]) {
  const prepare = vi.fn((sql: string) => {
    const usesCursor = sql.includes("stx_address > ?1");
    return {
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: rows.map((stx_address) => ({ stx_address })),
        }),
      }),
      _usesCursor: usesCursor,
    };
  });
  return { prepare } as unknown as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runCompetitionCron — walk + dispatch", () => {
  it("walks the address page, finds allowlisted txs, and submits them with source='cron'", async () => {
    const kv = makeKv();
    const db = makeDb(["SP_ADDR_001"]);
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

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv, HIRO_API_KEY: undefined },
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
    const kv = makeKv();
    const db = makeDb(["SP_ADDR_001"]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      {
        tx_id: "0xaaa",
        tx_type: "contract_call",
        contract_call: { contract_id: "SP00000.unknown-pool", function_name: "swap" },
      },
    ]);

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.found).toBe(0);
    expect(verifyAndPersistSwap).not.toHaveBeenCalled();
  });

  it("skips non-contract_call txs without dispatch", async () => {
    const kv = makeKv();
    const db = makeDb(["SP_ADDR_001"]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      { tx_id: "0xaaa", tx_type: "token_transfer" },
    ]);

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );
    expect(summary.found).toBe(0);
    expect(verifyAndPersistSwap).not.toHaveBeenCalled();
  });

  it("tallies inserted vs alreadyKnown vs pending vs rejected", async () => {
    const kv = makeKv();
    const db = makeDb(["SP_ADDR_001"]);
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

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
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

describe("runCompetitionCron — cursor persistence", () => {
  it("persists the next cursor when the page is full (more addresses to walk)", async () => {
    const kv = makeKv();
    const fullPage: string[] = Array.from(
      { length: CRON_MAX_ADDRESSES_PER_RUN },
      (_, i) => `SP_ADDR_${String(i).padStart(3, "0")}`
    );
    const db = makeDb(fullPage);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.cursor).toBe(fullPage[fullPage.length - 1]);
    expect(kv.put).toHaveBeenCalledWith("comp:cron:cursor", fullPage[fullPage.length - 1]);
  });

  it("deletes the cursor when the page is partial (walk wrapped)", async () => {
    const kv = makeKv("SP_PRIOR_CURSOR");
    const db = makeDb(["SP_ADDR_001", "SP_ADDR_002"]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.cursor).toBeNull();
    expect(kv.delete).toHaveBeenCalledWith("comp:cron:cursor");
  });

  it("uses the cursor query branch when a cursor is present", async () => {
    const kv = makeKv("SP_LAST_RUN");
    const db = makeDb([]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    const prepareCalls = (db.prepare as Mock).mock.calls;
    expect(prepareCalls[0][0]).toContain("stx_address > ?1");
  });

  it("uses the head-of-list query branch when no cursor is present", async () => {
    const kv = makeKv();
    const db = makeDb([]);
    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([]);

    await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    const sql = (db.prepare as Mock).mock.calls[0][0] as string;
    expect(sql).not.toContain("stx_address > ?");
  });
});

describe("runCompetitionCron — fault tolerance", () => {
  it("counts a verify throw as rejected and continues the sweep", async () => {
    const kv = makeKv();
    const db = makeDb(["SP_ADDR_001"]);
    (verifyAndPersistSwap as Mock).mockRejectedValueOnce(new Error("boom"));

    const fetchAddressTxsImpl = vi.fn().mockResolvedValue([
      { tx_id: "0xaaa", tx_type: "contract_call", contract_call: { contract_id: ALLOWED_CONTRACT, function_name: ALLOWED_FN } },
    ]);

    const summary = await runCompetitionCron(
      { DB: db, VERIFIED_AGENTS: kv },
      undefined,
      { fetchAddressTxsImpl }
    );

    expect(summary.rejected).toBe(1);
    expect(summary.inserted).toBe(0);
  });
});
