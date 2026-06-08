import { describe, it, expect } from "vitest";
import { fetchAgentPage } from "../d1";

/** D1 mock returning preset registered_wallets rows. */
function makeDb(rows: { stx_address: string; verified_at: string | null }[]) {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) }),
    }),
  } as unknown as D1Database;
}

describe("fetchAgentPage — join-date floor parsing", () => {
  it("parses verified_at (ISO) to unix seconds", async () => {
    const iso = "2026-01-01T00:00:00Z";
    const expectedSec = Math.floor(Date.parse(iso) / 1000);
    const out = await fetchAgentPage(makeDb([{ stx_address: "SP_A", verified_at: iso }]), null, 25);
    expect(out).toEqual([{ stxAddress: "SP_A", verifiedAtSec: expectedSec }]);
    expect(out[0].verifiedAtSec).toBeGreaterThan(0);
  });

  it("falls back to floor 0 (all-time) when verified_at is null or unparseable", async () => {
    const out = await fetchAgentPage(
      makeDb([
        { stx_address: "SP_NULL", verified_at: null },
        { stx_address: "SP_BAD", verified_at: "not-a-date" },
      ]),
      null,
      25
    );
    expect(out[0].verifiedAtSec).toBe(0);
    expect(out[1].verifiedAtSec).toBe(0);
  });
});
