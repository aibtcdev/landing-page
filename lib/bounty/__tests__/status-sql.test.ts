/**
 * `statusToSql()` compiles a status filter to a SQL predicate, while
 * `bountyStatus()` derives the same status in TS. The two must agree, or the
 * board shows rows whose rendered status contradicts the filter that fetched
 * them.
 *
 * These tests evaluate each SQL predicate in JS against representative records
 * and assert the result matches `bountyStatus()`. That is the invariant that
 * broke: `active` was `cancelled_at IS NULL AND paid_at IS NULL`, which admits
 * `abandoned` (terminal, but both fields NULL).
 */

import { describe, it, expect, vi } from "vitest";
import { bountyStatus, type BountyRecord, type BountyStatus } from "../types";
import { recordMemberPayments, statusToSql } from "../d1-helpers";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "../constants";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const t = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();

function rec(over: Partial<BountyRecord>): BountyRecord {
  return {
    id: "b1",
    posterBtcAddress: "bc1qposter",
    posterStxAddress: "SPPOSTER",
    title: "t",
    description: "d",
    rewardSats: 1000,
    submissionCount: 0,
    createdAt: iso(t - 60 * 86_400_000),
    expiresAt: iso(t + 86_400_000),
    updatedAt: iso(t),
    ...over,
  };
}

/** The seven canonical records, one per derived status. */
const FIXTURES: Record<BountyStatus, BountyRecord> = {
  scheduled: rec({
    opensAt: iso(t + 86_400_000),
    expiresAt: iso(t + 2 * 86_400_000),
  }),
  open: rec({ expiresAt: iso(t + 86_400_000) }),
  judging: rec({ expiresAt: iso(t - 86_400_000) }),
  "winner-announced": rec({
    expiresAt: iso(t - 86_400_000),
    acceptedAt: iso(t - 86_400_000),
    acceptedSubmissionId: "s1",
  }),
  paid: rec({
    expiresAt: iso(t - 86_400_000),
    acceptedAt: iso(t - 86_400_000),
    acceptedSubmissionId: "s1",
    paidAt: iso(t - 3_600_000),
    paidTxid: "0xabc",
  }),
  abandoned: rec({ expiresAt: iso(t - ACCEPT_GRACE_MS - 86_400_000) }),
  cancelled: rec({ cancelledAt: iso(t - 86_400_000) }),
};

/**
 * Evaluate a `statusToSql` predicate in JS. Supports exactly the operators the
 * bounty predicates use, positionally binding `?` in source order.
 */
function evalSql(sql: string, bindings: string[], b: BountyRecord): boolean {
  const col: Record<string, string | null> = {
    cancelled_at: b.cancelledAt ?? null,
    paid_at: b.paidAt ?? null,
    accepted_at: b.acceptedAt ?? null,
    expires_at: b.expiresAt,
    opens_at: b.opensAt ?? null,
  };
  let i = 0;
  const js = sql
    .replace(/(\w+) IS NOT NULL/g, (_m, c) => JSON.stringify(col[c] !== null))
    .replace(/(\w+) IS NULL/g, (_m, c) => JSON.stringify(col[c] === null))
    .replace(/(\w+)\s*(<=|>=|<|>)\s*\?/g, (_m, c, op) => {
      const lhs = col[c];
      const rhs = bindings[i++];
      if (lhs === null) return "false";
      const l = Date.parse(lhs);
      const r = Date.parse(rhs);
      const res = op === "<=" ? l <= r : op === ">=" ? l >= r : op === "<" ? l < r : l > r;
      return JSON.stringify(res);
    })
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||");
  return Function(`"use strict";return (${js});`)() as boolean;
}

const ALL: BountyStatus[] = [
  "scheduled",
  "open",
  "judging",
  "winner-announced",
  "paid",
  "abandoned",
  "cancelled",
];

describe("statusToSql agrees with bountyStatus", () => {
  it("fixtures derive the status they are named for", () => {
    for (const s of ALL) {
      expect(bountyStatus(FIXTURES[s], NOW), `fixture ${s}`).toBe(s);
    }
  });

  it.each(ALL)("status=%s matches exactly its own fixture", (target) => {
    const { sql, bindings } = statusToSql(target, NOW);
    for (const s of ALL) {
      expect(evalSql(sql, bindings, FIXTURES[s]), `filter ${target} vs ${s}`).toBe(s === target);
    }
  });
});

describe("active", () => {
  const { sql, bindings } = statusToSql("active", NOW);
  const NON_TERMINAL: BountyStatus[] = ["open", "judging", "winner-announced"];
  const TERMINAL: BountyStatus[] = ["paid", "abandoned", "cancelled"];

  it.each(NON_TERMINAL)("includes %s", (s) => {
    expect(evalSql(sql, bindings, FIXTURES[s])).toBe(true);
  });

  // The regression: `abandoned` is terminal but leaves cancelled_at and
  // paid_at NULL, so the old predicate admitted it onto the live board.
  it.each(TERMINAL)("excludes %s", (s) => {
    expect(evalSql(sql, bindings, FIXTURES[s])).toBe(false);
  });

  it("excludes a bounty abandoned via an unpaid acceptance", () => {
    const stale = rec({
      expiresAt: iso(t - 30 * 86_400_000),
      acceptedAt: iso(t - PAY_GRACE_MS - 86_400_000),
      acceptedSubmissionId: "s1",
    });
    expect(bountyStatus(stale, NOW)).toBe("abandoned");
    expect(evalSql(sql, bindings, stale)).toBe(false);
  });

  it("includes a bounty accepted just inside the pay grace window", () => {
    const fresh = rec({
      expiresAt: iso(t - 30 * 86_400_000),
      acceptedAt: iso(t - PAY_GRACE_MS + 60_000),
      acceptedSubmissionId: "s1",
    });
    expect(bountyStatus(fresh, NOW)).toBe("winner-announced");
    expect(evalSql(sql, bindings, fresh)).toBe(true);
  });
});

describe("recordMemberPayments pay-grace cutoff (#1110)", () => {
  function mockDb(changes: number[]) {
    const binds: unknown[][] = [];
    const runs: unknown[][] = [];
    const db = {
      prepare: vi.fn().mockImplementation(() => ({
        bind: (...args: unknown[]) => {
          binds.push(args);
          return { args, run: async () => (runs.push(args), { meta: { changes: 1 } }) };
        },
      })),
      batch: vi.fn().mockImplementation(async (stmts: unknown[]) =>
        stmts.map((_, i) => ({ meta: { changes: changes[i] ?? 0 } }))
      ),
    } as unknown as D1Database;
    return { db, binds, runs };
  }

  it("computes payCutoff from the on-chain paidAt timestamp rather than wall-clock arrival", async () => {
    // Batch order: member write, updated_at touch, bounty write. (binds are
    // in build order: member, bounty, touch.)
    const { db, binds } = mockDb([1, 1, 1]);
    const paidAt = "2026-10-09T14:43:24.000Z";
    const before = Date.now();
    const result = await recordMemberPayments(db, {
      bountyId: "mukrrrze1aaffcc1ff00",
      submissionId: "s1",
      txid: "0x5b60",
      paidAt,
      payments: [{ btcAddress: "bc1qwinner", eventIndex: 0 }],
    });
    const after = Date.now();

    expect(result).toEqual({ recorded: 1, recordedMembers: ["bc1qwinner"], bountyPaid: true });
    const expectedCutoff = new Date(Date.parse(paidAt) - PAY_GRACE_MS).toISOString();
    // Member row: txid, event index, on-chain paidAt, then the guarded bounty state.
    expect(binds[0]).toEqual([
      "0x5b60",
      0,
      paidAt,
      "s1",
      "bc1qwinner",
      "mukrrrze1aaffcc1ff00",
      "s1",
      expectedCutoff,
    ]);
    // Bounty row: flips to paid only when no member is left unpaid, taking
    // paid_txid / paid_at from the latest member payment (selected in SQL).
    expect(binds[1]).toEqual([
      "s1",
      "s1",
      expect.any(String),
      "mukrrrze1aaffcc1ff00",
      "s1",
      expectedCutoff,
      "s1",
    ]);
    // updated_at is wall-clock so a late abandoned -> paid flip is visible to
    // clients syncing on updatedAt, while paid_at keeps the on-chain time.
    const updatedAt = Date.parse(binds[1][2] as string);
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  it("reports a partial team payout without flipping the bounty to paid, and bumps updated_at", async () => {
    const { db, binds } = mockDb([1, 1, 0]);
    const result = await recordMemberPayments(db, {
      bountyId: "b1",
      submissionId: "s1",
      txid: "0xabc",
      paidAt: "2026-10-09T14:43:24.000Z",
      payments: [{ btcAddress: "bc1qlead", eventIndex: 2 }],
    });
    expect(result).toEqual({ recorded: 1, recordedMembers: ["bc1qlead"], bountyPaid: false });
    // The touch is guarded on a member row now carrying this payment.
    expect(binds[2]).toEqual([expect.any(String), "b1", "s1", "0xabc", "2026-10-09T14:43:24.000Z"]);
  });

  it("reports nothing recorded when no member row changed", async () => {
    const { db } = mockDb([0, 0, 0]);
    const result = await recordMemberPayments(db, {
      bountyId: "b1",
      submissionId: "s1",
      txid: "0xabc",
      paidAt: "2026-10-09T14:43:24.000Z",
      payments: [{ btcAddress: "bc1qlead", eventIndex: 2 }],
    });
    expect(result).toEqual({ recorded: 0, recordedMembers: [], bountyPaid: false });
  });
});
