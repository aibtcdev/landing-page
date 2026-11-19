import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { DB: {}, LOGS: undefined }, ctx: undefined }),
}));

const verifySignatureMock = vi.fn();
vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: (...args: unknown[]) => verifySignatureMock(...args),
}));

const getBountyMock = vi.fn();
const getSubmissionMock = vi.fn();
const listMembersMock = vi.fn();
const removeMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    getSubmission: (...args: unknown[]) => getSubmissionMock(...args),
    listMembers: (...args: unknown[]) => listMembersMock(...args),
    removePendingMember: (...args: unknown[]) => removeMock(...args),
  };
});

import { POST } from "../route";
import { NextRequest } from "next/server";

const BOUNTY_ID = "mtest0000000000000000";
const SUB_ID = "sub00000000000000001";
const LEAD = "bc1qlead00000000000000000000000000000000000";
const MATE = "bc1qmate00000000000000000000000000000000000";
const OTHER = "bc1qothr00000000000000000000000000000000000";
const STRANGER = "bc1qstrg00000000000000000000000000000000000";

const member = (btcAddress: string, role: "lead" | "member", confirmed: boolean, shareSats = 333) => ({
  btcAddress, stxAddress: `SP-${btcAddress}`, role, shareSats, confirmed,
});

function request(signer: string, memberAddr: string) {
  return new NextRequest(`https://aibtc.com/api/bounties/${BOUNTY_ID}/submissions/${SUB_ID}/remove-member`, {
    method: "POST",
    body: JSON.stringify({
      signerBtcAddress: signer,
      memberBtcAddress: memberAddr,
      signedAt: new Date().toISOString(),
      signature: "G".repeat(88),
    }),
    headers: { "Content-Type": "application/json" },
  });
}
const call = (signer: string, memberAddr: string) =>
  POST(request(signer, memberAddr), { params: Promise.resolve({ id: BOUNTY_ID, submissionId: SUB_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  verifySignatureMock.mockImplementation((_sig: string, _msg: string, addr: string) => ({ valid: true, address: addr }));
  getSubmissionMock.mockResolvedValue({ id: SUB_ID, bountyId: BOUNTY_ID, submitterBtcAddress: LEAD });
  getBountyMock.mockResolvedValue({
    id: BOUNTY_ID,
    rewardSats: 1000,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  listMembersMock
    .mockResolvedValueOnce(
      new Map([[SUB_ID, [member(LEAD, "lead", true, 334), member(MATE, "member", false), member(OTHER, "member", true)]]])
    )
    .mockResolvedValue(new Map([[SUB_ID, [member(LEAD, "lead", true, 500), member(OTHER, "member", true, 500)]]]));
  removeMock.mockResolvedValue(true);
});

describe("POST .../remove-member", () => {
  it("the lead drops a pending teammate; the reward is re-split across the members left", async () => {
    const res = await call(LEAD, MATE);
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith({}, {
      bountyId: BOUNTY_ID,
      submissionId: SUB_ID,
      memberBtcAddress: MATE,
    });
    const json = (await res.json()) as { teamStatus: string; team: { shareSats: number }[] };
    expect(json.teamStatus).toBe("confirmed");
    expect(json.team.map((m) => m.shareSats)).toEqual([500, 500]);
  });

  it("a pending teammate can decline their own invite", async () => {
    const res = await call(MATE, MATE);
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalled();
  });

  it("someone who is neither the lead nor that teammate cannot remove them", async () => {
    const res = await call(STRANGER, MATE);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_allowed");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("a teammate cannot remove another teammate", async () => {
    const res = await call(OTHER, MATE);
    expect(res.status).toBe(403);
  });

  it("a confirmed teammate cannot be removed", async () => {
    const res = await call(LEAD, OTHER);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("member_confirmed");
  });

  it("the lead cannot be removed", async () => {
    const res = await call(LEAD, LEAD);
    expect(res.status).toBe(422);
  });

  it("the signature must come from the signer", async () => {
    verifySignatureMock.mockReturnValue({ valid: true, address: STRANGER });
    const res = await call(LEAD, MATE);
    expect(res.status).toBe(403);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("nothing changes once a winner is picked", async () => {
    getBountyMock.mockResolvedValue({
      id: BOUNTY_ID,
      rewardSats: 1000,
      createdAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptedAt: new Date().toISOString(),
      acceptedSubmissionId: SUB_ID,
    });
    const res = await call(LEAD, MATE);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("bounty_closed");
  });

  it("reports a concurrent change as 409", async () => {
    removeMock.mockResolvedValue(false);
    const res = await call(LEAD, MATE);
    expect(res.status).toBe(409);
  });
});
