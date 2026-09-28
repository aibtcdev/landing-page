import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockD1Database = {};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: { DB: mockD1Database, LOGS: undefined },
    ctx: undefined,
  }),
}));

const listBountiesMock = vi.fn();
const listSubmissionsBySubmitterMock = vi.fn();

vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    listBounties: (...args: unknown[]) => listBountiesMock(...args),
    listSubmissionsBySubmitter: (...args: unknown[]) => listSubmissionsBySubmitterMock(...args),
  };
});

import { GET } from "../route";

describe("GET /api/bounties - status query parameter validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBountiesMock.mockResolvedValue({
      bounties: [],
      total: 0,
    });
    listSubmissionsBySubmitterMock.mockResolvedValue([]);
  });

  it("returns selfDoc envelope when no query parameters are provided", async () => {
    const req = new NextRequest("http://localhost/api/bounties");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.endpoint).toBe("/api/bounties");
    expect(json.get.filters.status).toBeDefined();
    expect(listBountiesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when status parameter is an unknown string (e.g. zzzz)", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=zzzz");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_status");
    expect(json.message).toContain("Invalid status 'zzzz'");
    expect(json.message).toContain("open, judging, winner-announced, paid, abandoned, cancelled, active");
    expect(listBountiesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when status parameter is completed (not in valid enum)", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=completed");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_status");
    expect(json.message).toContain("Invalid status 'completed'");
    expect(listBountiesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when status parameter is accepted", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=accepted");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_status");
    expect(listBountiesMock).not.toHaveBeenCalled();
  });

  it("accepts valid status='active'", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=active");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      mockD1Database,
      expect.objectContaining({ status: "active" })
    );
  });

  it("accepts valid status='open'", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=open");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      mockD1Database,
      expect.objectContaining({ status: "open" })
    );
  });

  it("accepts valid status='paid'", async () => {
    const req = new NextRequest("http://localhost/api/bounties?status=paid");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      mockD1Database,
      expect.objectContaining({ status: "paid" })
    );
  });

  it("defaults to status='active' when other filters are provided without status", async () => {
    const req = new NextRequest("http://localhost/api/bounties?limit=10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      mockD1Database,
      expect.objectContaining({ status: "active", limit: 10 })
    );
  });
});
