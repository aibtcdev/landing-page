import { describe, it, expect, vi } from "vitest";
import {
  windowStart,
  getAgentRollup,
  getPlatformEarnings,
  getEarningsLeaderboard,
} from "../reads";

const NOW = 1_000_000_000_000; // fixed unix ms
const NOW_SEC = Math.floor(NOW / 1000);
const DAY = 86_400;

describe("windowStart", () => {
  it("computes 7d / 30d / lifetime bounds in unix seconds", () => {
    expect(windowStart("7d", NOW)).toBe(NOW_SEC - 7 * DAY);
    expect(windowStart("30d", NOW)).toBe(NOW_SEC - 30 * DAY);
    expect(windowStart("lifetime", NOW)).toBe(0);
  });
});

/** D1 mock returning preset rows per query, capturing bind args. */
function makeDb(handlers: { match: (sql: string) => boolean; first?: unknown; all?: unknown[] }[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    db: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            calls.push({ sql, args });
            const h = handlers.find((x) => x.match(sql));
            return h?.first ?? null;
          },
          all: async () => {
            calls.push({ sql, args });
            const h = handlers.find((x) => x.match(sql));
            return { results: h?.all ?? [] };
          },
        }),
      }),
    } as unknown as D1Database,
  };
}

describe("getAgentRollup", () => {
  it("maps the totals + top source class query results", async () => {
    const { db } = makeDb([
      { match: (s) => s.includes("COUNT(DISTINCT"), first: { e7: 10, e30: 42.5, elife: 100, payers30: 3 } },
      { match: (s) => s.includes("GROUP BY source_class"), first: { source_class: "inbox_message" } },
    ]);
    const r = await getAgentRollup(db, "SP_AGENT", NOW);
    expect(r).toEqual({
      earnings_7d_usd: 10,
      earnings_30d_usd: 42.5,
      earnings_lifetime_usd: 100,
      unique_payers_30d: 3,
      top_source_class_30d: "inbox_message",
    });
  });

  it("defaults to zeros / null when the agent has no earnings", async () => {
    const { db } = makeDb([]);
    const r = await getAgentRollup(db, "SP_NEW", NOW);
    expect(r).toEqual({
      earnings_7d_usd: 0,
      earnings_30d_usd: 0,
      earnings_lifetime_usd: 0,
      unique_payers_30d: 0,
      top_source_class_30d: null,
    });
  });
});

describe("getPlatformEarnings", () => {
  it("returns totals + the 30d source breakdown", async () => {
    const { db } = makeDb([
      { match: (s) => s.includes("FROM agent_earnings WHERE is_earning = 1"), first: { e7: 5, e30: 20, elife: 50 } },
      {
        match: (s) => s.includes("GROUP BY source_class"),
        all: [
          { source_class: "inbox_message", total_usd: 12 },
          { source_class: "bounty", total_usd: 8 },
        ],
      },
    ]);
    const r = await getPlatformEarnings(db, NOW);
    expect(r.total_7d_usd).toBe(5);
    expect(r.total_30d_usd).toBe(20);
    expect(r.total_lifetime_usd).toBe(50);
    expect(r.by_source_class_30d).toHaveLength(2);
    expect(r.by_source_class_30d[0]).toEqual({ source_class: "inbox_message", total_usd: 12 });
  });
});

describe("getEarningsLeaderboard", () => {
  it("binds the window start and returns ranked rows", async () => {
    const { db, calls } = makeDb([
      {
        match: (s) => s.includes("LEFT JOIN agents"),
        all: [
          { stx_address: "SP_A", btc_address: "bc1a", display_name: "A", bns_name: null, earnings_usd: 99, unique_payers: 4, latest_at: 123 },
        ],
      },
    ]);
    const rows = await getEarningsLeaderboard(db, "30d", 20, 0, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].stx_address).toBe("SP_A");
    // first bind arg is the window start (30d ago, unix seconds)
    expect(calls[0].args[0]).toBe(NOW_SEC - 30 * DAY);
    expect(calls[0].args[1]).toBe(20); // limit
    expect(calls[0].args[2]).toBe(0); // offset
  });
});
