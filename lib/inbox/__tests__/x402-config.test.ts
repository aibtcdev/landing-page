import { describe, it, expect } from "vitest";
import { buildInboxPaymentRequirements } from "../x402-config";

const RECIPIENT = "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K";
const SPONSOR = "SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7";

describe("buildInboxPaymentRequirements", () => {
  it("omits extra.feePayer when no sponsor is configured", () => {
    const req = buildInboxPaymentRequirements(RECIPIENT, "mainnet", "stacks:1");
    expect(req.payTo).toBe(RECIPIENT);
    expect(req.extra).not.toHaveProperty("feePayer");
  });

  it("advertises extra.feePayer when a sponsor is configured", () => {
    const req = buildInboxPaymentRequirements(RECIPIENT, "mainnet", "stacks:1", SPONSOR);
    expect(req.extra.feePayer).toBe(SPONSOR);
    expect(req.extra.pricing).toEqual({ type: "fixed", tier: "inbox-message" });
  });
});
