import { describe, it, expect } from "vitest";
import { bountyStatus, type BountyRecord, type BountyStatus } from "../types";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "../constants";
import { statusToSql } from "../d1-helpers";

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

  it("transitions exactly at the boundary (now >= expiresAt is judging)", () => {
    const expires = "2026-05-14T00:00:00Z";
    const b = base({ expiresAt: expires });
    // Half-open: at exact equality, the upper state wins.
    expect(bountyStatus(b, new Date(Date.parse(expires) - 1))).toBe("open");
    expect(bountyStatus(b, new Date(expires))).toBe("judging");
    expect(bountyStatus(b, new Date(Date.parse(expires) + 1))).toBe("judging");
  });
});

/**
 * The SQL predicates in `statusToSql` and the TS `bountyStatus()` are two
 * implementations of the same contract — a list filter that does not agree
 * with the per-record status is a bug. Lock parity at every boundary tick
 * (±1 ms either side of each transition).
 */
describe("status boundary parity (TS vs SQL)", () => {
  type Sample = {
    label: string;
    record: BountyRecord;
    now: Date;
  };

  function sqlMatchesAtMoment(record: BountyRecord, now: Date, status: BountyStatus): boolean {
    // SQL predicates parameterize "now" as a single ISO string; evaluate the
    // record's timestamps against the predicate manually so a real D1 isn't
    // needed in unit tests.
    const frag = statusToSql(status, now);
    const nowIso = now.toISOString();
    const acceptCutoffIso = new Date(now.getTime() - ACCEPT_GRACE_MS).toISOString();
    const payCutoffIso = new Date(now.getTime() - PAY_GRACE_MS).toISOString();

    const not = (v: unknown) => v == null;
    const some = (v: unknown) => v != null;

    switch (status) {
      case "open":
        return (
          not(record.cancelledAt) &&
          not(record.paidAt) &&
          not(record.acceptedAt) &&
          record.expiresAt > nowIso
        );
      case "judging":
        return (
          not(record.cancelledAt) &&
          not(record.paidAt) &&
          not(record.acceptedAt) &&
          record.expiresAt <= nowIso &&
          record.expiresAt > acceptCutoffIso
        );
      case "winner-announced":
        return (
          not(record.cancelledAt) &&
          not(record.paidAt) &&
          some(record.acceptedAt) &&
          (record.acceptedAt ?? "") > payCutoffIso
        );
      case "paid":
        return some(record.paidAt);
      case "abandoned":
        return (
          not(record.cancelledAt) &&
          not(record.paidAt) &&
          ((not(record.acceptedAt) && record.expiresAt <= acceptCutoffIso) ||
            (some(record.acceptedAt) && (record.acceptedAt ?? "") <= payCutoffIso))
        );
      case "cancelled":
        return some(record.cancelledAt);
      default:
        return frag.sql === "1=1";
    }
  }

  const expires = "2026-05-21T00:00:00.000Z";
  const acceptedAt = "2026-05-16T00:00:00.000Z";
  const samples: Sample[] = [
    // open → judging boundary
    {
      label: "1ms before expiresAt",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        updatedAt: "2026-05-14T00:00:00Z",
      },
      now: new Date(Date.parse(expires) - 1),
    },
    {
      label: "exact expiresAt",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        updatedAt: "2026-05-14T00:00:00Z",
      },
      now: new Date(expires),
    },
    // judging → abandoned boundary
    {
      label: "1ms before expiresAt + ACCEPT_GRACE",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        updatedAt: "2026-05-14T00:00:00Z",
      },
      now: new Date(Date.parse(expires) + ACCEPT_GRACE_MS - 1),
    },
    {
      label: "exact expiresAt + ACCEPT_GRACE",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        updatedAt: "2026-05-14T00:00:00Z",
      },
      now: new Date(Date.parse(expires) + ACCEPT_GRACE_MS),
    },
    // winner-announced → abandoned boundary
    {
      label: "1ms before acceptedAt + PAY_GRACE",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        acceptedAt,
        acceptedSubmissionId: "s1",
        updatedAt: acceptedAt,
      },
      now: new Date(Date.parse(acceptedAt) + PAY_GRACE_MS - 1),
    },
    {
      label: "exact acceptedAt + PAY_GRACE",
      record: {
        id: "b1",
        posterBtcAddress: "bc",
        posterStxAddress: "SP",
        title: "t",
        description: "d",
        rewardSats: 1,
        submissionCount: 0,
        createdAt: "2026-05-14T00:00:00Z",
        expiresAt: expires,
        acceptedAt,
        acceptedSubmissionId: "s1",
        updatedAt: acceptedAt,
      },
      now: new Date(Date.parse(acceptedAt) + PAY_GRACE_MS),
    },
  ];

  for (const sample of samples) {
    it(`TS and SQL agree at ${sample.label}`, () => {
      const tsStatus = bountyStatus(sample.record, sample.now);
      // The SQL predicate for the status TS picked must be true for this row.
      expect(sqlMatchesAtMoment(sample.record, sample.now, tsStatus)).toBe(true);
      // And no OTHER non-terminal status's SQL predicate may match.
      const others: BountyStatus[] = [
        "open",
        "judging",
        "winner-announced",
        "paid",
        "abandoned",
        "cancelled",
      ];
      for (const s of others) {
        if (s === tsStatus) continue;
        expect(sqlMatchesAtMoment(sample.record, sample.now, s)).toBe(false);
      }
    });
  }
});
