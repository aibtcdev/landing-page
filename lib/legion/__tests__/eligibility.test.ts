import { describe, it, expect } from "vitest";
import { standardPrincipalsIn } from "../chain";
import { eligibilityOf } from "../server-state";

describe("standardPrincipalsIn", () => {
  it("returns standard principals and skips contract principals", () => {
    const repr =
      "(tuple (amount u3000) (event \"transfer\") " +
      "(from 'SP5Y3W3F78NKFH4HYFNDQMJC484VZWKDH35ZR2M9.elsalvador-yes-legion-v2) (side u1) " +
      "(to 'SP20GPDS5RYB5R7Y4F20PNHX4DQJYJ3WYJX5J4KWZ))";
    expect(standardPrincipalsIn(repr)).toEqual(["SP20GPDS5RYB5R7Y4F20PNHX4DQJYJ3WYJX5J4KWZ"]);
  });

  it("finds several principals in one event", () => {
    const repr =
      "(tuple (buyer 'SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E) (seller 'SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B))";
    expect(standardPrincipalsIn(repr)).toEqual([
      "SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E",
      "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
    ]);
  });

  it("returns nothing when no principal is printed", () => {
    expect(standardPrincipalsIn("(tuple (amount u1) (event \"mint\"))")).toEqual([]);
  });
});

describe("eligibilityOf", () => {
  it("counts holders at or above the minimum", () => {
    expect(eligibilityOf({ a: 999, b: 1000, c: 20000, d: 0 }, 1000, true)).toEqual({
      count: 2,
      minPosition: 1000,
      checked: 4,
      complete: true,
    });
  });

  it("reports an unknown count when the holder set could not be read", () => {
    expect(eligibilityOf(null, 1000, false)).toEqual({
      count: null,
      minPosition: 1000,
      checked: 0,
      complete: false,
    });
  });

  it("passes through a partial walk", () => {
    expect(eligibilityOf({ a: 5000 }, 1000, false).complete).toBe(false);
  });
});
