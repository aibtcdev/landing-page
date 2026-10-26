import { describe, it, expect } from "vitest";
import { validateCreateBounty } from "../validation";

function validBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const future = new Date(now + 7 * 86400000).toISOString();
  return {
    posterBtcAddress: "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3",
    title: "Test Bounty",
    description: "Do something great for the bounty board.",
    rewardSats: 5000,
    expiresAt: future,
    signedAt: new Date(now).toISOString(),
    signature: "G".repeat(88),
    ...overrides,
  };
}

describe("validateCreateBounty with optional opensAt (#1113)", () => {
  it("accepts a body without opensAt (omitted defaults to immediate open)", () => {
    const res = validateCreateBounty(validBody());
    expect("data" in res && res.data).toBeTruthy();
    if ("data" in res && res.data) {
      expect(res.data.opensAt).toBeUndefined();
    }
  });

  it("accepts a valid opensAt between now and expiresAt", () => {
    const now = Date.now();
    const opensAt = new Date(now + 2 * 86400000).toISOString();
    const expiresAt = new Date(now + 7 * 86400000).toISOString();
    const res = validateCreateBounty(validBody({ opensAt, expiresAt }));
    expect("data" in res && res.data).toBeTruthy();
    if ("data" in res && res.data) {
      expect(res.data.opensAt).toBe(opensAt);
    }
  });

  it("rejects an invalid opensAt timestamp format", () => {
    const res = validateCreateBounty(validBody({ opensAt: "not-a-date" }));
    expect("errors" in res && res.errors).toBeTruthy();
    if ("errors" in res && res.errors) {
      expect(res.errors.some((e) => e.field === "opensAt")).toBe(true);
    }
  });

  it("rejects opensAt >= expiresAt", () => {
    const now = Date.now();
    const opensAt = new Date(now + 8 * 86400000).toISOString();
    const expiresAt = new Date(now + 7 * 86400000).toISOString();
    const res = validateCreateBounty(validBody({ opensAt, expiresAt }));
    expect("errors" in res && res.errors).toBeTruthy();
    if ("errors" in res && res.errors) {
      const err = res.errors.find((e) => e.field === "opensAt");
      expect(err?.message).toContain("expiresAt must be at least 1h after opensAt");
    }
  });

  it("rejects a submission window under 1h measured from opensAt", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 7 * 86400000).toISOString();
    const opensAt = new Date(now + 7 * 86400000 - 1000).toISOString();
    const res = validateCreateBounty(validBody({ opensAt, expiresAt }));
    expect("errors" in res && res.errors).toBeTruthy();
    if ("errors" in res && res.errors) {
      const err = res.errors.find((e) => e.field === "opensAt");
      expect(err?.message).toContain("expiresAt must be at least 1h after opensAt");
    }
  });

  it("accepts a window of exactly 1h after opensAt", () => {
    const now = Date.now();
    const opensAt = new Date(now + 2 * 86400000).toISOString();
    const expiresAt = new Date(now + 2 * 86400000 + 3600000).toISOString();
    const res = validateCreateBounty(validBody({ opensAt, expiresAt }));
    expect("data" in res && res.data).toBeTruthy();
  });
});
