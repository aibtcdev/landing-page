/**
 * Tests for lib/competition/verify.ts
 *
 * Phase 3.1 PR-B — exercises the verifyAndPersistSwap pipeline end-to-end
 * with mocked Hiro fetch + mocked D1 statements. The parser has its own
 * dedicated tests (parse.test.ts) so we focus on the verifier's gating
 * logic and persistence shape here.
 *
 * Covered paths:
 *   - Hiro returns 404 → tx_not_found rejection (no D1 work)
 *   - Hiro fetch fails / non-2xx → tx_fetch_failed rejection
 *   - tx_status='pending' → { status: 'pending' } (no row written)
 *   - Sender not in registered_wallets → sender_not_registered rejection
 *   - Contract+function not allowlisted → contract_not_allowlisted rejection
 *   - Happy path: INSERT OR IGNORE writes row, returns verified+inserted
 *   - Idempotent re-submission: row already exists → verified+inserted=false
 *   - INSERT OR IGNORE race (changes=0): re-read returns row with the
 *     winning source intact
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Hiro fetch before importing verify.ts
vi.mock("@/lib/stacks-api-fetch", () => ({
  stacksApiFetch: vi.fn(),
}));

import { verifyAndPersistSwap } from "../verify";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import type { Mock } from "vitest";

const AGENT = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
const TXID = "0x46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";
const POOL = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";

const STX_ASSET = "stx";
const STSTX = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx";

function mockHiroResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildHappyTx() {
  return {
    tx_id: TXID,
    tx_status: "success",
    sender_address: AGENT,
    tx_type: "contract_call",
    burn_block_time: 1762547890,
    contract_call: {
      contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
      function_name: "swap-x-for-y",
      function_args: [],
    },
    events: [
      {
        event_index: 0,
        event_type: "stx_asset",
        asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
      },
      {
        event_index: 1,
        event_type: "ft_transfer_event",
        asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
      },
    ],
  };
}

/**
 * Build a D1 mock where each db.prepare(sql) returns a statement whose
 * .first()/.run() result depends on which SQL it sees. We key off the
 * leading-keyword pattern so re-ordering INSERT vs SELECT in verify.ts
 * doesn't break the fixture.
 */
function buildD1Mock(opts: {
  registered?: boolean;
  existingRow?: Record<string, unknown> | null;
  insertChanges?: number;
  afterInsertRow?: Record<string, unknown> | null;
  throwOn?: "read-existing" | "sender-check" | "insert" | null;
}) {
  let readExistingCalls = 0;
  const prepare = vi.fn((sql: string) => {
    const trimmed = sql.trim();

    if (trimmed.startsWith("INSERT OR IGNORE INTO swaps")) {
      return {
        bind: () => ({
          run: () => {
            if (opts.throwOn === "insert") {
              return Promise.reject(new Error("insert blew up"));
            }
            return Promise.resolve({ meta: { changes: opts.insertChanges ?? 1 } });
          },
        }),
      };
    }

    if (trimmed.startsWith("SELECT 1 AS ok FROM registered_wallets")) {
      return {
        bind: () => ({
          first: () => {
            if (opts.throwOn === "sender-check") {
              return Promise.reject(new Error("sender check blew up"));
            }
            return Promise.resolve(opts.registered ? { ok: 1 } : null);
          },
        }),
      };
    }

    if (trimmed.startsWith("SELECT") && trimmed.includes("FROM swaps") && trimmed.includes("WHERE txid")) {
      return {
        bind: () => ({
          first: () => {
            readExistingCalls++;
            if (opts.throwOn === "read-existing" && readExistingCalls === 1) {
              return Promise.reject(new Error("read existing blew up"));
            }
            // First call → existingRow (pre-insert); subsequent calls → afterInsertRow
            const row = readExistingCalls === 1 ? opts.existingRow : opts.afterInsertRow;
            return Promise.resolve(row ?? null);
          },
        }),
      };
    }

    throw new Error(`Unmocked SQL: ${trimmed.slice(0, 80)}`);
  });

  return { prepare } as unknown as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyAndPersistSwap — Hiro failure paths", () => {
  it("returns tx_not_found rejection when Hiro 404s", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(new Response("", { status: 404 }));
    const db = buildD1Mock({});
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_not_found");
  });

  it("returns tx_fetch_failed rejection when Hiro returns 5xx (after retries)", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(new Response("", { status: 503 }));
    const db = buildD1Mock({});
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_fetch_failed");
  });

  it("returns tx_fetch_failed rejection when stacksApiFetch throws (network down)", async () => {
    (stacksApiFetch as Mock).mockRejectedValue(new Error("connection refused"));
    const db = buildD1Mock({});
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_fetch_failed");
  });
});

describe("verifyAndPersistSwap — pending tx", () => {
  it("returns { status: 'pending' } for tx_status='pending' (no row written)", async () => {
    const pending = { ...buildHappyTx(), tx_status: "pending" };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(pending));
    const db = buildD1Mock({ registered: true });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("pending");
  });
});

describe("verifyAndPersistSwap — sender + allowlist gates", () => {
  it("rejects with sender_not_registered when sender is missing from registered_wallets", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: false });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("sender_not_registered");
  });

  it("rejects with contract_not_allowlisted for an off-allowlist contract", async () => {
    const tx = buildHappyTx();
    tx.contract_call.contract_id = "SP00000000000000000000.unknown-pool-v1";
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(tx));
    const db = buildD1Mock({ registered: true });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("contract_not_allowlisted");
  });

  it("rejects with contract_not_allowlisted for an allowlisted contract but wrong function", async () => {
    const tx = buildHappyTx();
    tx.contract_call.function_name = "unknown-function";
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(tx));
    const db = buildD1Mock({ registered: true });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("contract_not_allowlisted");
  });
});

describe("verifyAndPersistSwap — happy path", () => {
  it("inserts a new swap row and returns verified + inserted:true", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.inserted).toBe(true);
    expect(result.row.txid).toBe(TXID);
    expect(result.row.sender).toBe(AGENT);
    expect(result.row.token_in).toBe(STX_ASSET);
    expect(result.row.amount_in).toBe(1000000);
    expect(result.row.token_out).toBe(STSTX);
    expect(result.row.amount_out).toBe(859839);
    expect(result.row.source).toBe("agent");
    expect(result.row.scored_value).toBeNull();
  });

  it("propagates the source value into the persisted row", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "cron");
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.row.source).toBe("cron");
  });
});

describe("verifyAndPersistSwap — idempotent re-submission", () => {
  it("returns verified+inserted:false when the row already exists (early read)", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const existing = {
      txid: TXID,
      sender: AGENT,
      contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
      function_name: "swap-x-for-y",
      token_in: "stx",
      amount_in: 1000000,
      token_out: STSTX,
      amount_out: 859839,
      burn_block_time: 1762547890,
      tx_status: "success",
      source: "chainhook",
      scored_value: null,
      scored_at: null,
    };
    const db = buildD1Mock({ existingRow: existing });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.inserted).toBe(false);
    // Source comes from the existing row — first writer wins, NOT overwritten.
    expect(result.row.source).toBe("chainhook");
  });

  it("re-reads canonical row after INSERT OR IGNORE no-op race", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const winner = {
      txid: TXID,
      sender: AGENT,
      contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
      function_name: "swap-x-for-y",
      token_in: "stx",
      amount_in: 1000000,
      token_out: STSTX,
      amount_out: 859839,
      burn_block_time: 1762547890,
      tx_status: "success",
      source: "chainhook",
      scored_value: null,
      scored_at: null,
    };
    const db = buildD1Mock({
      registered: true,
      existingRow: null,
      insertChanges: 0,
      afterInsertRow: winner,
    });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.inserted).toBe(false);
    expect(result.row.source).toBe("chainhook");
  });
});

describe("verifyAndPersistSwap — D1 unavailability", () => {
  it("returns db_unavailable rejection when reading existing row throws", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ throwOn: "read-existing" });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("db_unavailable");
  });

  it("returns db_unavailable rejection when sender check throws", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ throwOn: "sender-check" });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("db_unavailable");
  });

  it("returns db_unavailable rejection when INSERT throws", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, throwOn: "insert" });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("db_unavailable");
  });
});
