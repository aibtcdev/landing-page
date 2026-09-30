import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { DB: {} }, ctx: undefined }),
}));

const listBountiesMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    listBounties: (...args: unknown[]) => listBountiesMock(...args),
  };
});

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  listBountiesMock.mockResolvedValue({ bounties: [], total: 0 });
});

describe("GET /api/bounties status filter (#1099)", () => {
  it("rejects unknown status filter with 400 and valid_values", async () => {
    const res = await GET(
      new NextRequest("https://aibtc.com/api/bounties?status=zzzz")
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      message: string;
      valid_values: string[];
    };
    expect(body.error).toBe("invalid_status");
    expect(body.message).toContain("zzzz");
    expect(body.valid_values).toContain("open");
    expect(body.valid_values).toContain("active");
    expect(listBountiesMock).not.toHaveBeenCalled();
  });

  it("accepts valid status filter like 'open'", async () => {
    const res = await GET(
      new NextRequest("https://aibtc.com/api/bounties?status=open")
    );
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "open" })
    );
  });

  it("defaults to 'active' when status param is omitted", async () => {
    const res = await GET(
      new NextRequest("https://aibtc.com/api/bounties?limit=10")
    );
    expect(res.status).toBe(200);
    expect(listBountiesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active" })
    );
  });
});
