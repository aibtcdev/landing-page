import { describe, it, expect } from "vitest";
import { splitReward } from "../types";
import { buildSubmitMessage, buildTeamConfirmMessage } from "../signatures";
import { validateSubmit, validateTeamConfirm } from "../validation";

const LEAD = "bc1qq9vpsra2cjmuvlx623ltsnw04cfxl2xevuahw3";
const MATE1 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const MATE2 = "bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c";

describe("splitReward", () => {
  it("splits evenly and gives the remainder to the lead", () => {
    expect(splitReward(1000, 3)).toEqual([334, 333, 333]);
    expect(splitReward(1000, 2)).toEqual([500, 500]);
    expect(splitReward(1003, 5)).toEqual([203, 200, 200, 200, 200]);
    expect(splitReward(5000, 1)).toEqual([5000]);
  });

  it("always adds up to the reward", () => {
    for (let n = 1; n <= 5; n++) {
      for (const r of [5, 7, 99, 1000, 123457]) {
        expect(splitReward(r, n).reduce((a, b) => a + b, 0)).toBe(r);
      }
    }
  });
});

describe("team signatures", () => {
  const base = {
    bountyId: "b1",
    submitterBtcAddress: LEAD,
    message: "work",
    contentUrl: "https://x.test",
    signedAt: "2026-11-19T00:00:00.000Z",
  };

  it("signs the same bytes as before for a solo entry", () => {
    const solo = `AIBTC Bounty Submit | b1 | ${LEAD} | work | https://x.test | 2026-11-19T00:00:00.000Z`;
    expect(buildSubmitMessage(base)).toBe(solo);
    expect(buildSubmitMessage({ ...base, teammates: [] })).toBe(solo);
  });

  it("appends the teammates in the order sent", () => {
    expect(buildSubmitMessage({ ...base, teammates: [MATE2, MATE1] })).toBe(
      `AIBTC Bounty Submit | b1 | ${LEAD} | work | https://x.test | 2026-11-19T00:00:00.000Z | ${MATE2},${MATE1}`
    );
  });

  it("binds a confirm to bounty, submission and member", () => {
    expect(
      buildTeamConfirmMessage({
        bountyId: "b1",
        submissionId: "s1",
        memberBtcAddress: MATE1,
        signedAt: "2026-11-19T00:00:00.000Z",
      })
    ).toBe(`AIBTC Bounty Team Confirm | b1 | s1 | ${MATE1} | 2026-11-19T00:00:00.000Z`);
  });
});

describe("validateSubmit teammates", () => {
  const body = {
    submitterBtcAddress: LEAD,
    message: "work",
    signedAt: "2026-11-19T00:00:00.000Z",
    signature: Buffer.alloc(65, 7).toString("base64"),
  };
  const fields = (r: ReturnType<typeof validateSubmit>) => (r.errors ?? []).map((e) => e.field);

  it("accepts up to 4 teammates", () => {
    const r = validateSubmit({ ...body, teammates: [MATE1, MATE2] });
    expect(r.errors).toBeUndefined();
    expect(r.data?.teammates).toEqual([MATE1, MATE2]);
  });

  it("treats missing, null and [] as solo", () => {
    for (const teammates of [undefined, null, []]) {
      const r = validateSubmit({ ...body, teammates });
      expect(r.errors).toBeUndefined();
      expect(r.data?.teammates).toBeUndefined();
    }
  });

  it("refuses more than 4 teammates", () => {
    const five = Array.from({ length: 5 }, (_, i) => `bc1q${String(i).repeat(38)}`);
    expect(fields(validateSubmit({ ...body, teammates: five }))).toContain("teammates");
  });

  it("refuses the lead listed as a teammate, a duplicate, a bad address and a non-array", () => {
    expect(fields(validateSubmit({ ...body, teammates: [LEAD] }))).toContain("teammates");
    expect(fields(validateSubmit({ ...body, teammates: [MATE1, MATE1] }))).toContain("teammates");
    expect(fields(validateSubmit({ ...body, teammates: ["1BadAddr"] }))).toContain("teammates[0]");
    expect(fields(validateSubmit({ ...body, teammates: MATE1 }))).toContain("teammates");
  });
});

describe("validateTeamConfirm", () => {
  it("requires btcAddress, signedAt and signature", () => {
    const r = validateTeamConfirm({});
    expect((r.errors ?? []).map((e) => e.field).sort()).toEqual(["btcAddress", "signature", "signedAt"]);
  });
});

import { teamState, withTeams } from "../d1-helpers";
import type { BountyTeamMember } from "../types";

describe("teamState", () => {
  const m = (btcAddress: string, confirmed: boolean): BountyTeamMember => ({
    btcAddress, stxAddress: "SP", role: "member", shareSats: 1, confirmed,
  });
  it("is confirmed only when every member confirmed, and lists who is missing", () => {
    expect(teamState([m("a", true), m("b", true)])).toEqual({ teamStatus: "confirmed", waitingOn: [] });
    expect(teamState([m("a", true), m("b", false)])).toEqual({ teamStatus: "pending", waitingOn: ["b"] });
  });
});

describe("withTeams for a submission stored without member rows", () => {
  const db = {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
  } as unknown as D1Database;
  const sub = {
    id: "s1", bountyId: "b1", submitterBtcAddress: LEAD, submitterStxAddress: "SPLEAD",
    message: "m", createdAt: "2026-11-19T00:00:00.000Z",
  };

  it("shows it as a confirmed solo entry with the whole reward", async () => {
    const [s] = await withTeams(db, [sub], { rewardSats: 700 });
    expect(s.teamSize).toBe(1);
    expect(s.teamStatus).toBe("confirmed");
    expect(s.team).toEqual([
      expect.objectContaining({ btcAddress: LEAD, stxAddress: "SPLEAD", role: "lead", shareSats: 700, confirmed: true }),
    ]);
  });

  it("carries the bounty's payout when it is the paid winner", async () => {
    const [s] = await withTeams(db, [sub], {
      rewardSats: 700, acceptedSubmissionId: "s1", paidTxid: "0xabc", paidAt: "2026-11-19T01:00:00.000Z",
    });
    expect(s.team?.[0]).toMatchObject({ paidTxid: "0xabc", paidAt: "2026-11-19T01:00:00.000Z" });
  });
});
