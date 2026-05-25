import { describe, expect, it } from "vitest";

describe("GET /bounties", () => {
  it("redirects to /bounty and preserves query params", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://aibtc.com/bounties?status=open&limit=20"));

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://aibtc.com/bounty?status=open&limit=20");
  });
});

