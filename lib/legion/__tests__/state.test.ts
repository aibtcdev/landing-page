import { describe, it, expect } from "vitest";
import { derivePhase, foldSide, participantsOf, predictOutcome } from "../state";
import { FALLBACK_PARAMS, LEGIONS, STATUS } from "../constants";
import type { EventRow } from "../chainhook";

const C = LEGIONS.yes.contract;
const A = "SP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0";
const B = "SP2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0";
const D = "SP3DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD0";
const rules = FALLBACK_PARAMS;
// Proposed at burn 1000: voting opens at 1002, closes at 1032, conclude until 1044.
const VOTE_END = 1000 + rules.voteDelay + rules.voteWindow;

let n = 0;
function ev(event: string, data: Record<string, unknown>, height: number, contract = C): EventRow {
  n += 1;
  return {
    txid: `0x${n.toString(16).padStart(4, "0")}`,
    event_index: 0,
    contract_id: contract,
    proposal_id: typeof data.proposalId === "number" ? data.proposalId : null,
    block_height: height,
    block_time: 1_789_000_000 + height,
    event,
    data: { event, ...data },
  };
}

const propose = ev(
  "propose",
  { proposalId: 1, proposer: A, title: "T", link: "https://x.test", payout: 3000, proposerWeight: 1300, voteEnd: VOTE_END, votableAtOpen: 5000, vault: 300000, description: "why" },
  10
);
const voteB = ev("vote", { proposalId: 1, voter: B, support: true, weight: 2000, rationale: "yes" }, 12);
const voteD = ev("vote", { proposalId: 1, voter: D, support: true, weight: 1000, rationale: "also yes" }, 13);

const ctx = (tip: number | null, weights: [string, number][] = []) => ({
  tip,
  rules,
  weights: new Map(weights),
  vault: 300000,
  totalCredits: 0,
});

describe("derivePhase", () => {
  const p = foldSide([propose], "yes", C, ctx(null)).proposals[0];
  it("walks pending → voting → concludable → expired on the burn tip", () => {
    expect(derivePhase(p, 1001, rules)).toBe("pending");
    expect(derivePhase(p, 1002, rules)).toBe("voting");
    expect(derivePhase(p, VOTE_END, rules)).toBe("concludable");
    expect(derivePhase(p, VOTE_END + rules.concludeWindow, rules)).toBe("expired");
  });
  it("lets a terminal status win", () => {
    expect(derivePhase({ ...p, status: STATUS.PASSED }, 1001, rules)).toBe("passed");
  });
});

describe("foldSide", () => {
  it("tallies votes, counts yes voters and keeps members in arrival order", () => {
    const side = foldSide([voteD, propose, voteB], "yes", C, ctx(1010, [[A, 1300], [B, 2000]]));
    const p = side.proposals[0];
    expect(p.yesWeight).toBe(3000);
    expect(p.yesVoterCount).toBe(2);
    expect(p.description).toBe("why");
    expect(p.openedAt).toBe(1000);
    expect(p.phase).toBe("voting");
    expect(p.nextBoundary).toBe(VOTE_END);
    expect(p.prediction?.outcome).toBe("PASSED");
    expect(side.members.map((m) => m.who)).toEqual([A, B, D]);
    expect(side.members[0].weight).toBe(1300);
    expect(side.members[2].weight).toBeNull();
    expect(side.summary).toEqual({ total: 1, pending: 1, verified: 0, rejected: 0 });
  });

  it("applies the conclude outcome and reason", () => {
    const conclude = ev("conclude", { proposalId: 1, outcome: "passed", reason: "paid-shares", recipient: A, payout: 3000 }, 20);
    const p = foldSide([propose, voteB, voteD, conclude], "yes", C, ctx(VOTE_END + 1)).proposals[0];
    expect(p.phase).toBe("passed");
    expect(p.bucket).toBe("verified");
    expect(p.reason).toBe("paid-shares");
    expect(p.prediction).toBeNull();
  });

  it("marks an open proposal past its conclude window not-concluded", () => {
    const p = foldSide([propose], "yes", C, ctx(VOTE_END + rules.concludeWindow + 5)).proposals[0];
    expect(p.bucket).toBe("rejected");
    expect(p.reason).toBe("not-concluded");
  });

  it("ignores the other legion's events", () => {
    const other = ev("propose", { proposalId: 7, proposer: A, voteEnd: VOTE_END }, 11, LEGIONS.no.contract);
    const side = foldSide([propose, other], "yes", C, ctx(1010));
    expect(side.proposals.map((p) => p.proposalId)).toEqual([1]);
    expect(participantsOf([propose, other, voteB], LEGIONS.no.contract)).toEqual([A]);
  });
});

describe("predictOutcome", () => {
  const base = foldSide([propose], "yes", C, ctx(1010)).proposals[0];
  const live = { proposerWeight: 1300, vault: 300000, totalCredits: 0 };

  it("follows conclude's branch order", () => {
    expect(predictOutcome({ ...base, yesVoterCount: 1, yesWeight: 5000 }, rules, live).outcome).toBe("NO_VOTERS");
    expect(predictOutcome({ ...base, yesVoterCount: 2, yesWeight: 3000, noWeight: 2000 }, rules, live).outcome).toBe("VOTED_DOWN");
    expect(
      predictOutcome({ ...base, yesVoterCount: 2, yesWeight: 3000 }, rules, { ...live, proposerWeight: 999 }).outcome
    ).toBe("NOT_HOLDING");
    expect(
      predictOutcome({ ...base, yesVoterCount: 2, yesWeight: 3000 }, rules, { ...live, vault: 2999 }).outcome
    ).toBe("POT_SHORT");
  });

  it("floors the approval percentage the way Clarity does", () => {
    // 30,000 yes against 15,454 no is exactly 66%; one more share of dissent is 65.
    const pass = predictOutcome({ ...base, yesVoterCount: 2, yesWeight: 30000, noWeight: 15454 }, rules, live);
    const fail = predictOutcome({ ...base, yesVoterCount: 2, yesWeight: 30000, noWeight: 15455 }, rules, live);
    expect(pass.approvalPct).toBe(66);
    expect(pass.outcome).toBe("PASSED");
    expect(fail.approvalPct).toBe(65);
    expect(fail.outcome).toBe("VOTED_DOWN");
  });
});
