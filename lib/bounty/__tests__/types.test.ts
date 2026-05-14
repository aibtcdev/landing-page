import { describe, it, expect } from "vitest";
import { bountyStatus, type BountyRecord } from "../types";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "../constants";

function base(overrides: Partial<BountyRecord> = {}): BountyRecord {
  const created = "2026-05-14T00:00:00Z";
  const expires = "2026-05-21T00:00:00Z";
  return {
    id: "b1",
    posterBtcAddress: "bc1qposter",
    posterStxAddress: "SP1POSTER",
    title: "t",
    description: "d",
    rewardSats: 1000,
    submissionCount: 0,
    createdAt: created,
    expiresAt: expires,
    updatedAt: created,
    ...overrides,
  };
}

describe("bountyStatus", () => {
  it("returns 'open' before expiresAt", () => {
    const b = base({ expiresAt: "2030-01-01T00:00:00Z" });
    expect(bountyStatus(b, new Date("2026-05-15T00:00:00Z"))).toBe("open");
  });

  it("returns 'judging' once expiresAt passes (within accept-grace)", () => {
    const expires = "2026-05-14T00:00:00Z";
    const b = base({ expiresAt: expires });
    // 1 day after expiry — still within the 14d accept grace
    expect(bountyStatus(b, new Date("2026-05-15T00:00:00Z"))).toBe("judging");
  });

  it("returns 'abandoned' after expiresAt + accept-grace with no winner", () => {
    const expires = "2026-05-14T00:00:00Z";
    const b = base({ expiresAt: expires });
    const wayLater = new Date(Date.parse(expires) + ACCEPT_GRACE_MS + 1000);
    expect(bountyStatus(b, wayLater)).toBe("abandoned");
  });

  it("returns 'winner-announced' when acceptedAt is set and within pay-grace", () => {
    const acceptedAt = "2026-05-15T00:00:00Z";
    const b = base({ acceptedAt, acceptedSubmissionId: "s1" });
    expect(bountyStatus(b, new Date("2026-05-16T00:00:00Z"))).toBe("winner-announced");
  });

  it("returns 'abandoned' when acceptedAt + pay-grace has elapsed without paidAt", () => {
    const acceptedAt = "2026-05-15T00:00:00Z";
    const b = base({ acceptedAt, acceptedSubmissionId: "s1" });
    const wayLater = new Date(Date.parse(acceptedAt) + PAY_GRACE_MS + 1000);
    expect(bountyStatus(b, wayLater)).toBe("abandoned");
  });

  it("returns 'paid' when paidAt is set (terminal beats any other check)", () => {
    const b = base({
      acceptedAt: "2026-05-15T00:00:00Z",
      acceptedSubmissionId: "s1",
      paidTxid: "0xabc",
      paidAt: "2026-05-16T00:00:00Z",
    });
    // Even far past pay-grace, status is paid (terminal wins).
    expect(bountyStatus(b, new Date("2030-01-01T00:00:00Z"))).toBe("paid");
  });

  it("returns 'cancelled' when cancelledAt is set", () => {
    const b = base({ cancelledAt: "2026-05-14T01:00:00Z" });
    expect(bountyStatus(b, new Date("2026-05-15T00:00:00Z"))).toBe("cancelled");
  });

  it("paid wins over cancelled if both somehow exist (defense in depth)", () => {
    const b = base({
      cancelledAt: "2026-05-14T01:00:00Z",
      paidAt: "2026-05-14T02:00:00Z",
      paidTxid: "0xabc",
    });
    expect(bountyStatus(b)).toBe("paid");
  });

  it("transitions exactly at the boundary (now > expiresAt is judging)", () => {
    const expires = "2026-05-14T00:00:00Z";
    const b = base({ expiresAt: expires });
    expect(bountyStatus(b, new Date(expires))).toBe("open");
    expect(bountyStatus(b, new Date(Date.parse(expires) + 1))).toBe("judging");
  });
});
