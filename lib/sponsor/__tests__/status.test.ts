import { describe, expect, it } from "vitest";
import {
  getRelaySponsorStatusFromBinding,
  normalizeSponsorStatusResult,
} from "../status";
import type { SponsorStatusResult } from "../types";

const baseStatus: SponsorStatusResult = {
  status: "degraded",
  canSponsor: false,
  walletCount: 3,
  recommendation: "fallback_to_direct",
  reasons: ["SNAPSHOT_STALE", "RECONCILIATION_STALE"],
  noncePool: {
    totalAvailable: 0,
    totalReserved: 2,
    totalCapacity: 12,
    poolAvailabilityRatio: 0,
    conflictsDetected: 1,
    lastConflictAt: "2026-03-30T00:00:00.000Z",
    healInProgress: true,
  },
  reconciliation: {
    source: "hiro",
    lastSuccessfulAt: "2026-03-30T00:00:00.000Z",
    freshness: "stale",
  },
  snapshot: {
    asOf: "2026-03-30T00:00:00.000Z",
    ageMs: 45_000,
    freshness: "stale",
  },
};

describe("normalizeSponsorStatusResult", () => {
  it("accepts the canonical relay contract", () => {
    expect(normalizeSponsorStatusResult(baseStatus)).toEqual(baseStatus);
  });

  it("rejects widened local fields from legacy Hiro-shaped payloads", () => {
    expect(
      normalizeSponsorStatusResult({
        ...baseStatus,
        sponsorAddress: "SP123",
        stxBalance: 10,
      })
    ).toEqual(baseStatus);
  });

  it("rejects invalid reason values", () => {
    expect(
      normalizeSponsorStatusResult({
        ...baseStatus,
        reasons: ["SNAPSHOT_STALE", "BALANCE_LOW"],
      })
    ).toBeNull();
  });
});

describe("getRelaySponsorStatusFromBinding", () => {
  it("returns null when the binding is unavailable", async () => {
    await expect(getRelaySponsorStatusFromBinding(undefined)).resolves.toBeNull();
  });

  it("returns null when the binding does not expose sponsor status yet", async () => {
    await expect(
      getRelaySponsorStatusFromBinding({
        submitPayment: async () => ({ accepted: true }),
        checkPayment: async () => ({ paymentId: "p", status: "queued" }),
      })
    ).resolves.toBeNull();
  });

  it("returns normalized sponsor status from the relay binding", async () => {
    await expect(
      getRelaySponsorStatusFromBinding({
        submitPayment: async () => ({ accepted: true }),
        checkPayment: async () => ({ paymentId: "p", status: "queued" }),
        getSponsorStatus: async () => baseStatus,
      })
    ).resolves.toEqual(baseStatus);
  });
});
