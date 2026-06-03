/**
 * Tests for /api/admin/schema-health
 *
 * Covers:
 *   (a) isScanWithoutIndex — SCAN detection helper: flagged cases
 *   (b) isScanWithoutIndex — SCAN detection helper: acceptable cases (index used)
 *   (c) isScanWithoutIndex — non-SCAN lines are never flagged
 *   (d) Admin auth rejection — 401 without X-Admin-Key
 */

import { describe, it, expect, vi } from "vitest";
import { isScanWithoutIndex } from "../route";

// ── (a-c) isScanWithoutIndex unit tests ─────────────────────────────────────

describe("isScanWithoutIndex: flagged cases", () => {
  it("(a1) bare SCAN with no USING clause is flagged", () => {
    expect(isScanWithoutIndex("SCAN inbox_messages")).toBe(true);
  });

  it("(a2) SCAN agents with no USING clause is flagged", () => {
    expect(isScanWithoutIndex("SCAN agents")).toBe(true);
  });

  it("(a3) SCAN with temp B-TREE note but no index is flagged", () => {
    // The temp-B-tree note appears on its OWN line; a SCAN line is separate.
    // This test verifies a SCAN line is flagged even when the detail has trailing text.
    expect(isScanWithoutIndex("SCAN bounties ")).toBe(true);
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
      isScanWithoutIndex(
        "SCAN inbox_messages USING INDEX idx_inbox_unread"
      )
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

// ── (d) Admin auth rejection ─────────────────────────────────────────────────
//
// We mock requireAdmin to return a 401 NextResponse and verify the GET handler
// short-circuits without trying to access the D1 binding.

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "Missing X-Admin-Key header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  ),
}));

// We also need to mock getCloudflareContext so the import resolves.
// If requireAdmin rejects before we reach getCloudflareContext, this mock
// should never be called — and that's what the test verifies.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn().mockRejectedValue(
    new Error("getCloudflareContext should not be called when auth fails")
  ),
}));

import { GET } from "../route";
import { requireAdmin } from "@/lib/admin/auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";

describe("GET /api/admin/schema-health: admin auth rejection", () => {
  it("(d) returns 401 and does not call getCloudflareContext when X-Admin-Key is missing", async () => {
    const request = new Request("https://example.com/api/admin/schema-health");
    const response = await GET(request as unknown as import("next/server").NextRequest);

    // requireAdmin must be called
    expect(requireAdmin).toHaveBeenCalledTimes(1);

    // Should be a 401 response
    expect(response.status).toBe(401);

    // getCloudflareContext must NOT be called — handler short-circuited
    expect(getCloudflareContext).not.toHaveBeenCalled();
  });
});
