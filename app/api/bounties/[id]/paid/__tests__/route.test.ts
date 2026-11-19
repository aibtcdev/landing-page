import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: { VERIFIED_AGENTS: {}, DB: {}, LOGS: undefined },
    ctx: undefined,
  }),
}));

const verifySignatureMock = vi.fn();
vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: (...args: unknown[]) => verifySignatureMock(...args),
}));

const getBountyMock = vi.fn();
const getSubmissionMock = vi.fn();
const isTxidRedeemedMock = vi.fn();
const verifyPayoutTxidMock = vi.fn();
const recordMemberPaymentsMock = vi.fn();
const listMembersMock = vi.fn();
const reserveTxidMock = vi.fn();

vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    getSubmission: (...args: unknown[]) => getSubmissionMock(...args),
    isTxidRedeemed: (...args: unknown[]) => isTxidRedeemedMock(...args),
    verifyPayoutTxid: (...args: unknown[]) => verifyPayoutTxidMock(...args),
    recordMemberPayments: (...args: unknown[]) => recordMemberPaymentsMock(...args),
    listMembers: (...args: unknown[]) => listMembersMock(...args),
    reserveTxid: (...args: unknown[]) => reserveTxidMock(...args),
  };
});

import { POST } from "../route";
import { NextRequest } from "next/server";
import {
  ACCEPT_GRACE_MS,
  PAY_GRACE_MS,
  type BountyRecord,
  type BountyTeamMember,
} from "@/lib/bounty";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POSTER_BTC = "bc1qposter0000000000000000000000000000000000";
const POSTER_STX = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const WINNER_BTC = "bc1qwinner0000000000000000000000000000000000";
const WINNER_STX = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const BOUNTY_ID = "mukrrrze1aaffcc1ff00";
const SUBMISSION_ID = "sub00000000000000001";
const TXID = "0x5b601f08468d72bc9091f5681414a098deb68b7613f30ef808d7a87cd6e33320";
const PARTNER_BTC = "bc1qpartner000000000000000000000000000000000";
const PARTNER_STX = "SP229F3KDGJJ79DMAPHKYQD6KF6DXM2NPAKHZ51HR";

function member(btcAddress: string, stxAddress: string, shareSats: number, paidTxid?: string): BountyTeamMember {
  return {
    btcAddress,
    stxAddress,
    role: btcAddress === WINNER_BTC ? "lead" : "member",
    shareSats,
    confirmed: true,
    ...(paidTxid && { paidTxid, paidAt: new Date().toISOString() }),
  };
}

const SOLO_TEAM = [member(WINNER_BTC, WINNER_STX, 5000)];

function verifiedSolo(blockTimeIso: string) {
  return {
    ok: true,
    canonicalTxid: TXID,
    blockTimeIso,
    matched: [{ btcAddress: WINNER_BTC, stxAddress: WINNER_STX, eventIndex: 0, amount: 5000 }],
    underpaid: [],
  };
}

function makeBounty(overrides: Partial<BountyRecord> = {}): BountyRecord {
  const now = Date.now();
  const createdAt = new Date(now - 20 * 86_400_000).toISOString();
  const expiresAt = new Date(now - 15 * 86_400_000).toISOString();
  const acceptedAt = new Date(now - 2 * 86_400_000).toISOString();
  return {
    id: BOUNTY_ID,
    posterBtcAddress: POSTER_BTC,
    posterStxAddress: POSTER_STX,
    title: "Test bounty",
    description: "Do the thing",
    rewardSats: 5000,
    submissionCount: 1,
    createdAt,
    expiresAt,
    acceptedSubmissionId: SUBMISSION_ID,
    acceptedAt,
    updatedAt: acceptedAt,
    ...overrides,
  };
}

function paidRequest(txid: string = TXID) {
  const body = {
    txid,
    signedAt: new Date().toISOString(),
    signature: "G".repeat(88),
  };
  return new NextRequest(`https://aibtc.com/api/bounties/${BOUNTY_ID}/paid`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifySignatureMock.mockReturnValue({ valid: true, address: POSTER_BTC });
  getSubmissionMock.mockResolvedValue({
    id: SUBMISSION_ID,
    bountyId: BOUNTY_ID,
    submitterBtcAddress: WINNER_BTC,
    submitterStxAddress: WINNER_STX,
    message: "Submission",
    createdAt: new Date(Date.now() - 16 * 86_400_000).toISOString(),
  });
  isTxidRedeemedMock.mockResolvedValue(null);
  listMembersMock.mockResolvedValue(new Map([[SUBMISSION_ID, SOLO_TEAM]]));
  recordMemberPaymentsMock.mockResolvedValue({ recorded: 1, bountyPaid: true });
  reserveTxidMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/bounties/[id]/paid — pay-grace window vs proof arrival (#1110)", () => {
  it("marks paid when status is winner-announced and payment landed inside PAY_GRACE_MS", async () => {
    const bounty = makeBounty();
    const blockTimeIso = new Date(Date.parse(bounty.acceptedAt!) + 3_600_000).toISOString();
    getBountyMock
      .mockResolvedValueOnce(bounty)
      .mockResolvedValueOnce({ ...bounty, paidTxid: TXID, paidAt: blockTimeIso });
    verifyPayoutTxidMock.mockResolvedValue(verifiedSolo(blockTimeIso));

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { bounty: { status: string; paidTxid: string } };
    expect(json.bounty.status).toBe("paid");
    expect(recordMemberPaymentsMock).toHaveBeenCalledWith(
      {},
      {
        bountyId: BOUNTY_ID,
        submissionId: SUBMISSION_ID,
        txid: TXID,
        paidAt: blockTimeIso,
        payments: [{ btcAddress: WINNER_BTC, eventIndex: 0 }],
      }
    );
  });

  it("marks paid when proof arrives after PAY_GRACE_MS (status abandoned) if on-chain payment landed inside PAY_GRACE_MS", async () => {
    // Accepted 8 days ago -> derived status is "abandoned", but on-chain tx
    // landed 2 days after acceptance (well inside the 7-day PAY_GRACE_MS window).
    const acceptedAt = new Date(Date.now() - PAY_GRACE_MS - 86_400_000).toISOString();
    const blockTimeIso = new Date(Date.parse(acceptedAt) + 2 * 86_400_000).toISOString();
    const bounty = makeBounty({ acceptedAt, updatedAt: acceptedAt });

    getBountyMock
      .mockResolvedValueOnce(bounty)
      .mockResolvedValueOnce({ ...bounty, paidTxid: TXID, paidAt: blockTimeIso });
    verifyPayoutTxidMock.mockResolvedValue(verifiedSolo(blockTimeIso));

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { bounty: { status: string; paidAt: string } };
    expect(json.bounty.status).toBe("paid");
    expect(json.bounty.paidAt).toBe(blockTimeIso);
    expect(recordMemberPaymentsMock).toHaveBeenCalledWith(
      {},
      {
        bountyId: BOUNTY_ID,
        submissionId: SUBMISSION_ID,
        txid: TXID,
        paidAt: blockTimeIso,
        payments: [{ btcAddress: WINNER_BTC, eventIndex: 0 }],
      }
    );
  });

  it("rejects with 422 invalid_state when on-chain payment landed at or after acceptedAt + PAY_GRACE_MS", async () => {
    const acceptedAt = new Date(Date.now() - PAY_GRACE_MS - 86_400_000).toISOString();
    // Paid exactly at the upper boundary (half-open: >= acceptedAt + PAY_GRACE_MS is late).
    const lateBlockTimeIso = new Date(Date.parse(acceptedAt) + PAY_GRACE_MS).toISOString();
    const bounty = makeBounty({ acceptedAt, updatedAt: acceptedAt });

    getBountyMock.mockResolvedValue(bounty);
    verifyPayoutTxidMock.mockResolvedValue(verifiedSolo(lateBlockTimeIso));

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string; status: string };
    expect(json.error).toBe("invalid_state");
    expect(json.status).toBe("abandoned");
    expect(json.message).toContain("pay-grace window closed");
    expect(recordMemberPaymentsMock).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After when Hiro is rate-limited, not a terminal 400", async () => {
    getBountyMock.mockResolvedValue(makeBounty());
    verifyPayoutTxidMock.mockResolvedValue({
      ok: false,
      code: "RATE_LIMITED",
      message: "Hiro rate limit reached. Retry after a short delay.",
      retryAfterSeconds: 7,
    });

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    const json = (await res.json()) as { code: string; retryAfterSeconds: number };
    expect(json).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 7 });
    expect(recordMemberPaymentsMock).not.toHaveBeenCalled();
  });

  it("answers 503 with Retry-After when Hiro cannot be read, not a terminal 400", async () => {
    getBountyMock.mockResolvedValue(makeBounty());
    verifyPayoutTxidMock.mockResolvedValue({
      ok: false,
      code: "HIRO_UNREACHABLE",
      message: "Could not read the transaction events.",
    });

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const json = (await res.json()) as { code: string; retryAfterSeconds: number };
    expect(json).toMatchObject({ code: "HIRO_UNREACHABLE", retryAfterSeconds: 30 });
    expect(recordMemberPaymentsMock).not.toHaveBeenCalled();
  });

  it("rejects with 422 before hitting Hiro when bounty was abandoned without ever accepting a submission", async () => {
    const expiresAt = new Date(Date.now() - ACCEPT_GRACE_MS - 86_400_000).toISOString();
    const unacceptedAbandoned = makeBounty({
      expiresAt,
      acceptedAt: undefined,
      acceptedSubmissionId: undefined,
    });
    getBountyMock.mockResolvedValue(unacceptedAbandoned);

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string; status: string };
    expect(json.error).toBe("invalid_state");
    expect(json.status).toBe("abandoned");
    expect(json.message).toContain("Accept a submission first");
    expect(verifyPayoutTxidMock).not.toHaveBeenCalled();
    expect(recordMemberPaymentsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/bounties/[id]/paid: team payouts", () => {
  const TEAM = [member(WINNER_BTC, WINNER_STX, 2500), member(PARTNER_BTC, PARTNER_STX, 2500)];

  it("asks the verifier for every unpaid member at their own share", async () => {
    const bounty = makeBounty();
    const blockTimeIso = new Date(Date.parse(bounty.acceptedAt!) + 3_600_000).toISOString();
    getBountyMock.mockResolvedValue(bounty);
    listMembersMock.mockResolvedValue(new Map([[SUBMISSION_ID, TEAM]]));
    verifyPayoutTxidMock.mockResolvedValue({
      ok: true,
      canonicalTxid: TXID,
      blockTimeIso,
      matched: [{ btcAddress: WINNER_BTC, stxAddress: WINNER_STX, eventIndex: 0, amount: 2500 }],
      underpaid: [],
    });
    recordMemberPaymentsMock.mockResolvedValue({ recorded: 1, bountyPaid: false });

    await POST(paidRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });

    expect(verifyPayoutTxidMock.mock.calls[0][0].recipients).toEqual([
      { btcAddress: WINNER_BTC, stxAddress: WINNER_STX, amountSats: 2500 },
      { btcAddress: PARTNER_BTC, stxAddress: PARTNER_STX, amountSats: 2500 },
    ]);
  });

  it("paying only the lead leaves the bounty unpaid and names who is still owed", async () => {
    const bounty = makeBounty();
    const blockTimeIso = new Date(Date.parse(bounty.acceptedAt!) + 3_600_000).toISOString();
    getBountyMock.mockResolvedValue(bounty);
    listMembersMock
      .mockResolvedValueOnce(new Map([[SUBMISSION_ID, TEAM]]))
      .mockResolvedValueOnce(
        new Map([[SUBMISSION_ID, [member(WINNER_BTC, WINNER_STX, 2500, TXID), TEAM[1]]]])
      );
    verifyPayoutTxidMock.mockResolvedValue({
      ok: true,
      canonicalTxid: TXID,
      blockTimeIso,
      matched: [{ btcAddress: WINNER_BTC, stxAddress: WINNER_STX, eventIndex: 0, amount: 5000 }],
      underpaid: [],
    });
    recordMemberPaymentsMock.mockResolvedValue({ recorded: 1, bountyPaid: false });

    const res = await POST(paidRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bounty: { status: string };
      payout: { membersPaid: number; membersTotal: number; unpaid: { btcAddress: string; amountSats: number }[] };
      message: string;
    };
    expect(json.bounty.status).toBe("winner-announced");
    expect(json.payout).toMatchObject({ membersPaid: 1, membersTotal: 2 });
    expect(json.payout.unpaid).toEqual([{ btcAddress: PARTNER_BTC, stxAddress: PARTNER_STX, amountSats: 2500 }]);
    expect(json.message).toContain(PARTNER_STX);
  });

  it("answers 409 already_paid once every member is paid, without calling Hiro", async () => {
    getBountyMock.mockResolvedValue(makeBounty());
    listMembersMock.mockResolvedValue(
      new Map([[SUBMISSION_ID, TEAM.map((m) => ({ ...m, paidTxid: TXID }))]])
    );
    const res = await POST(paidRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_paid");
    expect(verifyPayoutTxidMock).not.toHaveBeenCalled();
  });

  it("answers 409 already_paid for a bounty that is already paid", async () => {
    getBountyMock.mockResolvedValue(makeBounty({ paidAt: new Date().toISOString(), paidTxid: TXID }));
    const res = await POST(paidRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_paid");
    expect(verifyPayoutTxidMock).not.toHaveBeenCalled();
  });

  it("answers 409 when a unique index refuses the payment record", async () => {
    const bounty = makeBounty();
    const blockTimeIso = new Date(Date.parse(bounty.acceptedAt!) + 3_600_000).toISOString();
    getBountyMock.mockResolvedValue(bounty);
    verifyPayoutTxidMock.mockResolvedValue(verifiedSolo(blockTimeIso));
    recordMemberPaymentsMock.mockRejectedValue(new Error("UNIQUE constraint failed"));
    const res = await POST(paidRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("txid_already_redeemed");
  });
});
