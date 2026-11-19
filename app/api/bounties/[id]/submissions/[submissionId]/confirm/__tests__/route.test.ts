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
const enteredAgentsMock = vi.fn();
const confirmMemberMock = vi.fn();
const dropInvitesMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    getSubmission: (...args: unknown[]) => getSubmissionMock(...args),
    listMembers: (...args: unknown[]) => listMembersMock(...args),
    enteredAgents: (...args: unknown[]) => enteredAgentsMock(...args),
    confirmMember: (...args: unknown[]) => confirmMemberMock(...args),
    dropUnconfirmableInvites: (...args: unknown[]) => dropInvitesMock(...args),
  };
});

import { POST } from "../route";
import { NextRequest } from "next/server";

const BOUNTY_ID = "mtest0000000000000000";
const SUB_ID = "sub00000000000000001";
const LEAD = "bc1qlead00000000000000000000000000000000000";
const MATE = "bc1qmate00000000000000000000000000000000000";

function team(mateConfirmed: boolean) {
  return [
    { btcAddress: LEAD, stxAddress: "SP1", role: "lead", shareSats: 334, confirmed: true },
    { btcAddress: MATE, stxAddress: "SP2", role: "member", shareSats: 333, confirmed: mateConfirmed },
  ];
}

function confirmRequest() {
  return new NextRequest(`https://aibtc.com/api/bounties/${BOUNTY_ID}/submissions/${SUB_ID}/confirm`, {
    method: "POST",
    body: JSON.stringify({ btcAddress: MATE, signedAt: new Date().toISOString(), signature: "G".repeat(88) }),
    headers: { "Content-Type": "application/json" },
  });
}
const call = () => POST(confirmRequest(), { params: Promise.resolve({ id: BOUNTY_ID, submissionId: SUB_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  verifySignatureMock.mockReturnValue({ valid: true, address: MATE });
  getSubmissionMock.mockResolvedValue({ id: SUB_ID, bountyId: BOUNTY_ID });
  getBountyMock.mockResolvedValue({
    id: BOUNTY_ID,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  listMembersMock
    .mockResolvedValueOnce(new Map([[SUB_ID, team(false)]]))
    .mockResolvedValue(new Map([[SUB_ID, team(true)]]));
  enteredAgentsMock.mockResolvedValue(new Set());
  confirmMemberMock.mockResolvedValue(true);
  dropInvitesMock.mockResolvedValue(0);
});

describe("POST /api/bounties/[id]/submissions/[submissionId]/confirm", () => {
  it("confirms an invited teammate", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { teamStatus: string }).teamStatus).toBe("confirmed");
    expect(confirmMemberMock).toHaveBeenCalledWith({}, SUB_ID, MATE, expect.any(String));
    // Their other pending invites on this bounty can no longer be confirmed.
    expect(dropInvitesMock).toHaveBeenCalledWith({}, BOUNTY_ID, MATE);
  });

  it("reports the teammate's share from the fresh team, not the one read before confirming", async () => {
    // A concurrent removal re-split the team between the read and the confirm.
    listMembersMock.mockReset()
      .mockResolvedValueOnce(new Map([[SUB_ID, team(false)]]))
      .mockResolvedValue(new Map([[SUB_ID, [
        { btcAddress: LEAD, stxAddress: "SP1", role: "lead", shareSats: 500, confirmed: true },
        { btcAddress: MATE, stxAddress: "SP2", role: "member", shareSats: 500, confirmed: true },
      ]]]));
    const res = await call();
    expect(((await res.json()) as { yourShareSats: number }).yourShareSats).toBe(500);
  });

  it("refuses with 409 already_entered when the teammate already has an entry on this bounty", async () => {
    enteredAgentsMock.mockResolvedValue(new Set([MATE]));
    const res = await call();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_entered");
    expect(confirmMemberMock).not.toHaveBeenCalled();
  });

  it("maps a concurrent second confirmed entry (unique index) to 409 already_entered", async () => {
    confirmMemberMock.mockRejectedValue(new Error("D1_ERROR: UNIQUE constraint failed: bounty_submission_members.bounty_id"));
    const res = await call();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_entered");
  });

  it("does not turn an unrelated database error into already_entered", async () => {
    confirmMemberMock.mockRejectedValue(new Error("D1_ERROR: database is locked"));
    const res = await call();
    expect(res.status).toBe(500);
  });

  it("is idempotent for a teammate who already confirmed this entry", async () => {
    listMembersMock.mockReset().mockResolvedValue(new Map([[SUB_ID, team(true)]]));
    const res = await call();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { alreadyConfirmed?: boolean }).alreadyConfirmed).toBe(true);
    expect(enteredAgentsMock).not.toHaveBeenCalled();
  });

  it("refuses an agent who is not on the team", async () => {
    verifySignatureMock.mockReturnValue({ valid: true, address: MATE });
    listMembersMock.mockReset().mockResolvedValue(new Map([[SUB_ID, [team(false)[0]]]]));
    const res = await call();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_a_team_member");
  });
});
