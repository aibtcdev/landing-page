import { describe, expect, it } from "vitest";
import { validateCreateBounty } from "../validation";

function validCreateBody(description: string) {
  return {
    posterBtcAddress: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
    title: "Improve bounty submission filters",
    description,
    rewardSats: 5000,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    signedAt: new Date().toISOString(),
    signature: "/".repeat(88),
  };
}

describe("validateCreateBounty multi-winner copy guard", () => {
  function expectDescriptionRejected(description: string) {
    const result = validateCreateBounty(validCreateBody(description));
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(result.errors.some((e) => e.field === "description")).toBe(true);
      expect(result.errors.some((e) => e.message.includes("multi-winner support"))).toBe(true);
    }
  }

  it("rejects 'up to N winners' phrasing", () => {
    expectDescriptionRejected("Up to 3 winners. First report accepted wins.");
  });

  it("rejects 'multiple winners' phrasing", () => {
    expectDescriptionRejected("Multiple winners possible if submissions are distinct.");
  });

  it("rejects first-come first-paid phrasing", () => {
    expectDescriptionRejected("First-come, first-paid until all payouts are used.");
  });

  it("rejects slot-cap phrasing", () => {
    expectDescriptionRejected("This bounty has a 3-slot cap for accepted submissions.");
  });

  it("rejects slots-remaining phrasing", () => {
    expectDescriptionRejected("2 slots remaining for this payout.");
  });

  it("accepts descriptions that do not imply multiple winners", () => {
    const result = validateCreateBounty(
      validCreateBody("Single winner bounty. Submit one implementation with tests and PR.")
    );
    expect("data" in result).toBe(true);
    if ("data" in result) {
      expect(result.data.description).toContain("Single winner bounty");
    }
  });
});
