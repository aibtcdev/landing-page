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
  it("rejects descriptions that suggest multi-winner payout semantics", () => {
    const result = validateCreateBounty(
      validCreateBody("Up to 3 winners. First-come first-paid within the 3-slot cap.")
    );
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(result.errors.some((e) => e.field === "description")).toBe(true);
      expect(result.errors[0]?.message).toContain("multi-winner support");
    }
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
