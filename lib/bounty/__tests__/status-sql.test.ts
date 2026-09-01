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

import { describe, it, expect } from "vitest";
import { bountyStatus, type BountyRecord, type BountyStatus } from "../types";
import { statusToSql } from "../d1-helpers";
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

/** The six canonical records, one per derived status. */
const FIXTURES: Record<BountyStatus, BountyRecord> = {
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
