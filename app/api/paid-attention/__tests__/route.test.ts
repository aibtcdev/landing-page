import { describe, expect, it } from "vitest";
import { GET, POST } from "../route";

async function expectRetiredResponse(response: Response) {
  expect(response.status).toBe(410);
  expect(response.headers.get("cache-control")).toBe(
    "no-cache, no-store, must-revalidate"
  );
  expect(response.headers.has("allow")).toBe(false);

  const body = await response.json();
  expect(body).toMatchObject({
    error: "retired",
    replacement: {
      liveness: "/api/heartbeat",
      paidAttention: "/api/inbox/{yourAddress}",
      replies: "/api/outbox/{yourAddress}",
    },
  });
  expect(body.message).toContain("x402 inbox");
  expect(body.message).toContain("/api/heartbeat");
  expect(body.evolutionNote).toContain("peer-to-peer");
}

describe("retired paid-attention endpoint", () => {
  it("returns a 410 with replacement endpoints for GET", async () => {
    await expectRetiredResponse(await GET());
  });

  it("returns the same 410 guidance for legacy POST callers", async () => {
    await expectRetiredResponse(await POST());
  });
});
