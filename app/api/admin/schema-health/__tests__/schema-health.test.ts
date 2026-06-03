/**
 * Tests for /api/admin/schema-health
 *
 * Covers:
 *   (a) isScanWithoutIndex — SCAN detection helper: flagged cases
 *   (b) isScanWithoutIndex — SCAN detection helper: acceptable cases (index used)
 *   (c) isScanWithoutIndex — non-SCAN lines are never flagged
 *   (d) isScanWithoutIndex — SCAN SUBQUERY is NOT misclassified as a table-scan
 *   (e) Admin auth rejection — 401 without X-Admin-Key
 *   (f) GET handler — 200 and healthy:true when all expected indexes present
 *   (g) GET handler — 503 and healthy:false when expected index dropped (fallback index used)
 *   (h) GET handler — 503 and healthy:false when expected index missing from sqlite_master
 *
 * Mock ordering follows the pattern from app/api/admin/backfill/__tests__/route.test.ts:
 *   vi.mock(...) declarations FIRST, then import of the route module AFTER.
 *   This ensures the mock is installed before the module factory resolves,
 *   preventing the real requireAdmin/getCloudflareContext from being bound.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Module mocks — MUST come before route import ─────────────────────────────

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { isScanWithoutIndex } from "../scan-detection";
import { GET } from "../route";
import { requireAdmin } from "@/lib/admin/auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// ── (a-d) isScanWithoutIndex unit tests ──────────────────────────────────────

describe("isScanWithoutIndex: flagged cases", () => {
  it("(a1) bare SCAN with no USING clause is flagged", () => {
    expect(isScanWithoutIndex("SCAN inbox_messages")).toBe(true);
  });

  it("(a2) SCAN agents with no USING clause is flagged", () => {
    expect(isScanWithoutIndex("SCAN agents")).toBe(true);
  });

  it("(a3) SCAN with trailing whitespace but no index is flagged", () => {
    // The temp-B-tree note appears on its OWN line; a SCAN line is separate.
    // This test verifies a SCAN line is flagged even when the detail has trailing text.
    expect(isScanWithoutIndex("SCAN bounties ")).toBe(true);
  });

  it("(a4) SCAN with leading whitespace (indented plan line) and no index is flagged", () => {
    expect(isScanWithoutIndex("  SCAN inbox_messages")).toBe(true);
  });
});

describe("isScanWithoutIndex: acceptable cases (index used)", () => {
  it("(b1) SCAN with USING COVERING INDEX is NOT flagged", () => {
    expect(
      isScanWithoutIndex(
        "SCAN inbox_messages USING COVERING INDEX idx_inbox_to_btc_sent_at"
      )
    ).toBe(false);
  });

  it("(b2) SCAN with USING INDEX is NOT flagged", () => {
    expect(
      isScanWithoutIndex("SCAN inbox_messages USING INDEX idx_inbox_unread")
    ).toBe(false);
  });

  it("(b3) SEARCH with USING INDEX is NOT flagged", () => {
    expect(
      isScanWithoutIndex(
        "SEARCH inbox_messages USING INDEX idx_inbox_to_btc_sent_at (to_btc_address=?)"
      )
    ).toBe(false);
  });

  it("(b4) SEARCH with USING COVERING INDEX is NOT flagged", () => {
    expect(
      isScanWithoutIndex(
        "SEARCH agents USING COVERING INDEX idx_agents_verified_at"
      )
    ).toBe(false);
  });
});

describe("isScanWithoutIndex: non-SCAN informational lines", () => {
  it("(c1) USE TEMP B-TREE FOR ORDER BY is NOT flagged", () => {
    expect(isScanWithoutIndex("USE TEMP B-TREE FOR ORDER BY")).toBe(false);
  });

  it("(c2) empty string is NOT flagged", () => {
    expect(isScanWithoutIndex("")).toBe(false);
  });

  it("(c3) COMPOUND QUERY plan line is NOT flagged", () => {
    expect(isScanWithoutIndex("COMPOUND QUERY")).toBe(false);
  });
});

describe("isScanWithoutIndex: SCAN SUBQUERY not misclassified", () => {
  it("(d1) SCAN SUBQUERY ... is NOT flagged as a table-scan regression", () => {
    expect(isScanWithoutIndex("SCAN SUBQUERY 1")).toBe(false);
  });

  it("(d2) SCAN SUBQUERY with additional text is NOT flagged", () => {
    expect(isScanWithoutIndex("SCAN SUBQUERY 2 AS t")).toBe(false);
  });

  it("(d3) indented SCAN SUBQUERY is NOT flagged", () => {
    expect(isScanWithoutIndex("  SCAN SUBQUERY 1")).toBe(false);
  });
});

// ── (e) Admin auth rejection ──────────────────────────────────────────────────

describe("GET /api/admin/schema-health: admin auth rejection", () => {
  beforeEach(() => {
    (requireAdmin as Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing X-Admin-Key header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("(e) returns 401 and does not call getCloudflareContext when X-Admin-Key is missing", async () => {
    const request = new Request(
      "https://example.com/api/admin/schema-health"
    );
    const response = await GET(
      request as unknown as import("next/server").NextRequest
    );

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(getCloudflareContext).not.toHaveBeenCalled();
  });
});

// ── Helpers for (f-h) handler tests ──────────────────────────────────────────

/**
 * Build a minimal D1Database mock.
 * - `explainResults`: plan detail lines returned for EXPLAIN QUERY PLAN calls
 * - `masterIndexes`: rows returned from the sqlite_master query
 */
function buildDbMock(
  explainResults: string[],
  masterIndexes: Array<{ name: string; tbl_name: string; sql: string | null }>
): D1Database {
  const db = {
    prepare: vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn((..._args: unknown[]) => stmt),
        all: vi.fn(async () => {
          if (sql.startsWith("EXPLAIN QUERY PLAN")) {
            return {
              results: explainResults.map((detail, i) => ({
                id: i,
                parent: 0,
                notused: 0,
                detail,
              })),
            };
          }
          // sqlite_master query
          return { results: masterIndexes };
        }),
      };
      return stmt;
    }),
  } as unknown as D1Database;
  return db;
}

function makeAdminRequest(): Request {
  return new Request("https://example.com/api/admin/schema-health", {
    headers: { "X-Admin-Key": "test-key" },
  });
}

// ── (f) Healthy: expected indexes present ────────────────────────────────────

describe("GET /api/admin/schema-health: healthy when all expected indexes present", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as Mock).mockResolvedValue(null);
  });

  it("(f) returns 200 and healthy:true when plan references expected index and index is in sqlite_master", async () => {
    // All explicit (non-autoindex) expected index names across all HOT_QUERIES.
    // The plan mock returns lines referencing all of these so every query's
    // planUsesExpectedIndex check passes. The sqlite_master mock includes all
    // explicit indexes so the missingFromMaster check passes too.
    // sqlite_autoindex_agent_inbox_stats_1 is skipped from master check by design.
    const allExplicitIndexNames = [
      "idx_inbox_to_btc_sent_at",
      "idx_swaps_token_in_active",
      "idx_swaps_sender_burn_time",
      "idx_agents_verified_at",
      "idx_bounties_active_created",
    ];
    // Also include the autoindex in the plan so inbox_unread_stats is covered
    const allPlanIndexNames = [
      ...allExplicitIndexNames,
      "sqlite_autoindex_agent_inbox_stats_1",
    ];

    // Plan mentions all expected indexes (one line per index, same plan returned
    // for every query in this mock — each query's planText will include all names)
    const planLines = allPlanIndexNames.map(
      (name) => `SEARCH table USING COVERING INDEX ${name} (?)`
    );

    const masterIndexes = allExplicitIndexNames.map((name) => ({
      name,
      tbl_name: "some_table",
      sql: `CREATE INDEX ${name} ON some_table(col)`,
    }));

    const db = buildDbMock(planLines, masterIndexes);
    (getCloudflareContext as Mock).mockResolvedValue({ env: { DB: db } });

    const response = await GET(
      makeAdminRequest() as unknown as import("next/server").NextRequest
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(body.flaggedCount).toBe(0);
  });
});

// ── (g) Unhealthy: expected index dropped but fallback index used ─────────────

describe("GET /api/admin/schema-health: unhealthy when expected index dropped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as Mock).mockResolvedValue(null);
  });

  it("(g) returns 503 and healthy:false when EXPLAIN uses a fallback index after drop of intended index", async () => {
    // Simulate: idx_bounties_active_created was dropped; planner falls back to
    // idx_bounties_created (a different, non-partial index). The EXPLAIN plan
    // would NOT contain "idx_bounties_active_created" — only "idx_bounties_created".
    // isScanWithoutIndex would NOT flag this (it's still using AN index), but the
    // expected-index check MUST flag it.

    // Provide plan lines that reference a fallback index but NOT the expected one.
    // For the inbox_list / bounty_list / agents_list queries, use the expected ones
    // except for bounty_list which uses the fallback.
    const db = {
      prepare: vi.fn((sql: string) => {
        const stmt = {
          bind: vi.fn((..._args: unknown[]) => stmt),
          all: vi.fn(async () => {
            if (sql.startsWith("EXPLAIN QUERY PLAN")) {
              // Return a plan that uses a fallback index for bounties,
              // but the correct ones for all other queries
              if (sql.includes("FROM bounties")) {
                return {
                  results: [
                    {
                      id: 0,
                      parent: 0,
                      notused: 0,
                      // Fallback: idx_bounties_created instead of idx_bounties_active_created
                      detail:
                        "SCAN bounties USING INDEX idx_bounties_created ORDER BY created_at DESC",
                    },
                  ],
                };
              }
              // All other queries: plan uses expected indexes
              return {
                results: [
                  {
                    id: 0,
                    parent: 0,
                    notused: 0,
                    detail:
                      "SEARCH table USING COVERING INDEX idx_inbox_to_btc_sent_at (?)",
                  },
                ],
              };
            }
            // sqlite_master: idx_bounties_active_created IS MISSING (dropped),
            // but idx_bounties_created is still present
            return {
              results: [
                {
                  name: "idx_inbox_to_btc_sent_at",
                  tbl_name: "inbox_messages",
                  sql: null,
                },
                {
                  name: "sqlite_autoindex_agent_inbox_stats_1",
                  tbl_name: "agent_inbox_stats",
                  sql: null,
                },
                {
                  name: "idx_swaps_token_in_active",
                  tbl_name: "swaps",
                  sql: null,
                },
                {
                  // idx_bounties_active_created is ABSENT — this is the regression
                  name: "idx_bounties_created",
                  tbl_name: "bounties",
                  sql: null,
                },
                {
                  name: "idx_agents_verified_at",
                  tbl_name: "agents",
                  sql: null,
                },
              ],
            };
          }),
        };
        return stmt;
      }),
    } as unknown as D1Database;

    (getCloudflareContext as Mock).mockResolvedValue({ env: { DB: db } });

    const response = await GET(
      makeAdminRequest() as unknown as import("next/server").NextRequest
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
    expect(body.flaggedCount).toBeGreaterThan(0);

    const bountyResult = body.queries.find(
      (q: { name: string }) => q.name === "bounty_list"
    );
    expect(bountyResult).toBeDefined();
    expect(bountyResult.flagged).toBe(true);
    expect(bountyResult.missingIndex).toBeDefined();
  });
});

// ── (h) Unhealthy: expected index missing from sqlite_master ─────────────────

describe("GET /api/admin/schema-health: unhealthy when expected index absent from sqlite_master", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as Mock).mockResolvedValue(null);
  });

  it("(h) returns 503 and healthy:false when expected index is absent from sqlite_master even if plan looks clean", async () => {
    // Simulate a state where EXPLAIN returns a clean plan (no bare SCAN),
    // but the expected index is completely missing from sqlite_master.
    // This covers the belt-and-suspenders check: the index was dropped
    // (migration regressed) even before EXPLAIN reflects the full impact.

    const allExpectedIndexes = [
      "idx_inbox_to_btc_sent_at",
      "sqlite_autoindex_agent_inbox_stats_1",
      "idx_swaps_token_in_active",
      "idx_bounties_active_created",
      "idx_agents_verified_at",
    ];

    // EXPLAIN plan looks fine — references expected indexes
    const cleanPlanLines = allExpectedIndexes.map(
      (name) => `SEARCH table USING COVERING INDEX ${name} (?)`
    );

    // sqlite_master is EMPTY — all indexes are missing
    const db = buildDbMock(cleanPlanLines, []);
    (getCloudflareContext as Mock).mockResolvedValue({ env: { DB: db } });

    const response = await GET(
      makeAdminRequest() as unknown as import("next/server").NextRequest
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
    expect(body.flaggedCount).toBeGreaterThan(0);

    // Queries with explicit CREATE INDEX entries must be flagged (not in sqlite_master).
    // inbox_unread_stats uses a sqlite_autoindex which is exempt from the master check,
    // so it will be healthy (its plan still references the autoindex).
    const explicitIndexQueries = ["inbox_list", "bounty_list", "agents_list"];
    for (const name of explicitIndexQueries) {
      const q = body.queries.find((r: { name: string }) => r.name === name);
      expect(q).toBeDefined();
      expect(q.flagged).toBe(true);
      expect(q.missingIndex).toBeDefined();
    }
  });
});
