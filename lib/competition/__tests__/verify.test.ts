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
import { COMP_START_TIMESTAMP } from "../constants";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import type { Mock } from "vitest";

const AGENT = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
const TXID = "0x46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";
const POOL = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";

const STX_ASSET = "stx";
const STSTX = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx";

// Post-comp-start fixture value used by the happy-path tx. The comp-start
// gate (see `verifyAndPersistSwap — comp-start gate`) covers the pre-start
// case explicitly; every other test wants to be past the gate by default.
const POST_START_BURN_TIME = COMP_START_TIMESTAMP + 86400; // start + 1 day

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
    burn_block_time: POST_START_BURN_TIME,
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
  /**
   * Genesis-level (Level 2) eligibility — requires the agent has a verified
   * or rewarded viral claim per `lib/levels.ts:67-87`. Defaults to `true`
   * when `registered: true` so happy-path tests written before the Genesis
   * gate landed continue to pass without modification. Set explicitly to
   * `false` to exercise the `sender_not_genesis` rejection path.
   */
  genesis?: boolean;
  /**
   * ERC-8004 on-chain identity requirement for competition eligibility.
   * Defaults to `true` for registered happy paths. Set explicitly to `false`
   * to exercise the identity_register requirement from #815.
   */
  hasIdentity?: boolean;
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

    if (
      trimmed.startsWith("SELECT") &&
      trimmed.includes("FROM registered_wallets") &&
      trimmed.includes("genesis")
    ) {
      return {
        bind: () => ({
          first: () => {
            if (opts.throwOn === "sender-check") {
              return Promise.reject(new Error("sender check blew up"));
            }
            if (!opts.registered) return Promise.resolve(null);
            // Default `genesis` to true when registered is true — happy-path
            // tests written before the Genesis gate landed assume verification
            // succeeds. Tests exercising the gate set `genesis: false` explicitly.
            const genesis = opts.genesis ?? true;
            const hasIdentity = opts.hasIdentity ?? true;
            return Promise.resolve({
              registered: 1,
              genesis: genesis ? 1 : 0,
              has_identity: hasIdentity ? 1 : 0,
            });
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

describe("verifyAndPersistSwap — success-only gate (whoabuddy's spec)", () => {
  // Migration 005 allows 8 terminal tx_status values in `swaps`. The comp
  // only counts `success`; non-success terminals (abort_by_*, dropped_*)
  // are rejected with `tx_failed` BEFORE we hit the sender / allowlist /
  // parse stages, so no row is written for failed swaps.
  it.each([
    ["abort_by_response"],
    ["abort_by_post_condition"],
    ["dropped_replace_by_fee"],
    ["dropped_replace_across_fork"],
    ["dropped_too_expensive"],
    ["dropped_stale_garbage_collect"],
    ["dropped_problematic"],
  ])("rejects tx_status=%s with code 'tx_failed' (no row written)", async (status) => {
    const failedTx = { ...buildHappyTx(), tx_status: status };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(failedTx));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_failed");
    expect(result.reason).toContain(status);
  });

  it("rejects BEFORE sender/allowlist checks (cheap fail-fast)", async () => {
    // Even with an unregistered sender + off-allowlist contract, a failed
    // tx_status should short-circuit to tx_failed first — proves the gate
    // runs before downstream DB work.
    const failedTx = {
      ...buildHappyTx(),
      tx_status: "abort_by_post_condition",
      sender_address: "SP000000000000000000",
      contract_call: {
        contract_id: "SP00000.not-on-allowlist",
        function_name: "swap-x",
        function_args: [],
      },
    };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(failedTx));
    const db = buildD1Mock({ registered: false });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_failed");
    // NOT sender_not_registered or contract_not_allowlisted — tx_failed
    // wins the race.
  });
});

describe("verifyAndPersistSwap — comp-start gate", () => {
  it("rejects a tx whose burn_block_time predates COMP_START_TIMESTAMP", async () => {
    const preStartTx = { ...buildHappyTx(), burn_block_time: COMP_START_TIMESTAMP - 1 };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(preStartTx));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("before_comp_start");
    expect(result.reason).toContain(String(COMP_START_TIMESTAMP));
  });

  it("accepts a tx whose burn_block_time equals COMP_START_TIMESTAMP exactly (boundary)", async () => {
    const boundaryTx = { ...buildHappyTx(), burn_block_time: COMP_START_TIMESTAMP };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(boundaryTx));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.row.burn_block_time).toBe(COMP_START_TIMESTAMP);
  });

  it("lets tx_failed win when a pre-start tx is also failed (cheap fail-fast)", async () => {
    // Pre-start AND non-success terminal: tx_failed gate runs first, so
    // before_comp_start should NOT be the rejection code. Proves ordering.
    const preStartFailed = {
      ...buildHappyTx(),
      burn_block_time: COMP_START_TIMESTAMP - 1,
      tx_status: "abort_by_post_condition",
    };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(preStartFailed));
    const db = buildD1Mock({ registered: true });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("tx_failed");
  });

  it("rejects pre-start BEFORE sender/allowlist checks", async () => {
    // Pre-start + unregistered sender + off-allowlist contract: before_comp_start
    // should win the race, proving the gate runs before downstream DB work.
    const preStartUnregistered = {
      ...buildHappyTx(),
      burn_block_time: COMP_START_TIMESTAMP - 1,
      sender_address: "SP000000000000000000",
      contract_call: {
        contract_id: "SP00000.not-on-allowlist",
        function_name: "swap-x",
        function_args: [],
      },
    };
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(preStartUnregistered));
    const db = buildD1Mock({ registered: false });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("before_comp_start");
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

  it("rejects with sender_not_genesis when sender is registered (Level 1) but has no verified claim (Level 2)", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, genesis: false });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("sender_not_genesis");
    expect(result.reason).toMatch(/Genesis/);
  });

  it("rejects with sender_not_registered when sender is Genesis but has no ERC-8004 identity", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, genesis: true, hasIdentity: false });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("sender_not_registered");
    expect(result.reason).toMatch(/ERC-8004/);
    expect(result.reason).toMatch(/identity_register/);
  });

  it("uses an aggregated Genesis lookup so multiple claim rows cannot downgrade a verified agent", async () => {
    (stacksApiFetch as Mock).mockResolvedValue(mockHiroResponse(buildHappyTx()));
    const db = buildD1Mock({ registered: true, insertChanges: 1 });
    const result = await verifyAndPersistSwap({}, db, TXID, "agent");
    expect(result.status).toBe("verified");

    const prepare = db.prepare as unknown as Mock;
    const eligibilitySql = prepare.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("FROM registered_wallets"));
    expect(eligibilitySql).toContain("MAX(CASE WHEN c.status IN ('verified', 'rewarded')");
    expect(eligibilitySql).toContain("a.erc8004_agent_id IS NOT NULL");
    expect(eligibilitySql).toContain("LEFT JOIN agents");
    expect(eligibilitySql).toContain("GROUP BY rw.stx_address");
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
