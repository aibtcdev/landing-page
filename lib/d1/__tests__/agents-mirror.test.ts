/**
 * Unit tests for `lib/d1/agents-mirror.ts`.
 *
 * Asserts SQL shape + bind values for `insertAgentToD1` and `updateAgentInD1`
 * so subsequent schema/column changes can't silently drift between the
 * mirror and the admin backfill (`app/api/admin/backfill/route.ts:260`).
 */

import { describe, it, expect, vi } from "vitest";
import { insertAgentToD1, updateAgentInD1 } from "../agents-mirror";
import type { AgentRecord } from "@/lib/types";

const TEST_BTC = "bc1qtest1address1mock1";
const TEST_STX = "SP1TESTADDRESS1234";
const TEST_REFERRER_BTC = "bc1qreferrertestaddr";
const TEST_REFERRAL_CODE = "ABCDEF";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    btcAddress: TEST_BTC,
    stxAddress: TEST_STX,
    stxPublicKey: "02mock_stx_pubkey",
    btcPublicKey: "03mock_btc_pubkey",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** D1 mock that captures prepare/bind/run calls. */
function makeMockDb() {
  const runs: Array<{ sql: string; binds: unknown[] }> = [];
  let nextThrowOnRun: Error | null = null;
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        run: vi.fn(async () => {
          const captured = { sql, binds };
          runs.push(captured);
          if (nextThrowOnRun) {
            const err = nextThrowOnRun;
            nextThrowOnRun = null;
            throw err;
          }
          return { meta: { changes: 1 } };
        }),
      })),
    })),
  } as unknown as D1Database;
  return {
    db,
    runs,
    throwOnNextRun(err: Error) {
      nextThrowOnRun = err;
    },
  };
}

describe("insertAgentToD1", () => {
  it("no-ops when db is undefined", async () => {
    await expect(
      insertAgentToD1(undefined, makeAgent(), TEST_REFERRAL_CODE)
    ).resolves.toBeUndefined();
  });

  it("issues an INSERT with 17 bind values (referred_by_btc hardcoded NULL)", async () => {
    const { db, runs } = makeMockDb();

    await insertAgentToD1(db, makeAgent(), TEST_REFERRAL_CODE);

    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("INSERT INTO agents");
    expect(runs[0].sql).toContain("ON CONFLICT(btc_address) DO NOTHING");
    // 17 placeholders + 1 hardcoded NULL = 18 columns; bind() receives 17 values.
    expect(runs[0].binds).toHaveLength(17);
    expect(runs[0].binds[0]).toBe(TEST_BTC);
    expect(runs[0].binds[1]).toBe(TEST_STX);
    // referral_code is the last bind value.
    expect(runs[0].binds[16]).toBe(TEST_REFERRAL_CODE);
  });

  it("coerces empty btcPublicKey to null (BIP-322 case)", async () => {
    const { db, runs } = makeMockDb();

    await insertAgentToD1(db, makeAgent({ btcPublicKey: "" }), TEST_REFERRAL_CODE);

    // btc_public_key is the 4th bind value.
    expect(runs[0].binds[3]).toBeNull();
  });

  it("fires a second-pass UPDATE for referred_by_btc when agent.referredBy is set", async () => {
    const { db, runs } = makeMockDb();

    await insertAgentToD1(
      db,
      makeAgent({ referredBy: TEST_REFERRER_BTC }),
      TEST_REFERRAL_CODE
    );

    expect(runs).toHaveLength(2);
    expect(runs[0].sql).toContain("INSERT INTO agents");
    expect(runs[1].sql).toContain("UPDATE agents SET referred_by_btc");
    expect(runs[1].sql).toContain("referred_by_btc IS NULL");
    expect(runs[1].binds).toEqual([TEST_REFERRER_BTC, TEST_BTC]);
  });

  it("does NOT fire the second-pass UPDATE when agent.referredBy is absent", async () => {
    const { db, runs } = makeMockDb();

    await insertAgentToD1(db, makeAgent(), TEST_REFERRAL_CODE);

    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("INSERT INTO agents");
  });

  it("swallows FK errors from the second-pass referred_by_btc UPDATE", async () => {
    const mock = makeMockDb();

    // Allow the INSERT, then throw on the next run (the UPDATE).
    const { db, runs } = mock;
    let runCount = 0;
    (db.prepare as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        run: vi.fn(async () => {
          runCount++;
          runs.push({ sql, binds });
          if (runCount === 2) {
            throw new Error(
              "FOREIGN KEY constraint failed: agents.referred_by_btc -> agents.btc_address"
            );
          }
          return { meta: { changes: 1 } };
        }),
      })),
    }));

    // Should NOT throw — the FK error from the 2nd-pass UPDATE is swallowed.
    await expect(
      insertAgentToD1(
        db,
        makeAgent({ referredBy: TEST_REFERRER_BTC }),
        TEST_REFERRAL_CODE
      )
    ).resolves.toBeUndefined();

    expect(runs).toHaveLength(2);
  });
});

describe("updateAgentInD1", () => {
  it("no-ops when db is undefined", async () => {
    await expect(updateAgentInD1(undefined, makeAgent())).resolves.toBeUndefined();
  });

  it("issues an UPDATE that preserves immutable referred_by_btc via COALESCE", async () => {
    const { db, runs } = makeMockDb();

    await updateAgentInD1(db, makeAgent());

    expect(runs).toHaveLength(1);
    expect(runs[0].sql).toContain("UPDATE agents SET");
    expect(runs[0].sql).toContain("referred_by_btc = COALESCE(?, referred_by_btc)");
    expect(runs[0].sql).toContain("btc_public_key = COALESCE(?, btc_public_key)");
    // Last bind value is the WHERE clause's btc_address.
    expect(runs[0].binds[runs[0].binds.length - 1]).toBe(TEST_BTC);
  });

  it("binds agent.referredBy when present so an incoming non-null value wins", async () => {
    const { db, runs } = makeMockDb();

    await updateAgentInD1(db, makeAgent({ referredBy: TEST_REFERRER_BTC }));

    // referred_by_btc bind is the 12th in the UPDATE (matches column order).
    // bind order after P3A: 0=taproot, 1=display_name, 2=description,
    // 3=bns_name, 4=owner, 5=last_active_at, 6=last_check_in_at,
    // 7=erc8004_agent_id, 8=nostr_public_key, 9=capabilities_json,
    // 10=last_identity_check, 11=github_username, 12=referred_by_btc.
    expect(runs[0].binds[12]).toBe(TEST_REFERRER_BTC);
  });

  it("binds null for referred_by_btc when absent so COALESCE preserves existing", async () => {
    const { db, runs } = makeMockDb();

    await updateAgentInD1(db, makeAgent());

    expect(runs[0].binds[12]).toBeNull();
  });
});
