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
const setPaidMock = vi.fn();
const reserveTxidMock = vi.fn();

vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    getSubmission: (...args: unknown[]) => getSubmissionMock(...args),
    isTxidRedeemed: (...args: unknown[]) => isTxidRedeemedMock(...args),
    verifyPayoutTxid: (...args: unknown[]) => verifyPayoutTxidMock(...args),
    setPaid: (...args: unknown[]) => setPaidMock(...args),
    reserveTxid: (...args: unknown[]) => reserveTxidMock(...args),
  };
});

import { POST } from "../route";
import { NextRequest } from "next/server";
import { ACCEPT_GRACE_MS, PAY_GRACE_MS, type BountyRecord } from "@/lib/bounty";

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
  setPaidMock.mockResolvedValue(true);
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
    verifyPayoutTxidMock.mockResolvedValue({
      ok: true,
      canonicalTxid: TXID,
      blockTimeIso,
    });

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { bounty: { status: string; paidTxid: string } };
    expect(json.bounty.status).toBe("paid");
    expect(setPaidMock).toHaveBeenCalledWith({}, BOUNTY_ID, TXID, blockTimeIso);
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
    verifyPayoutTxidMock.mockResolvedValue({
      ok: true,
      canonicalTxid: TXID,
      blockTimeIso,
    });

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { bounty: { status: string; paidAt: string } };
    expect(json.bounty.status).toBe("paid");
    expect(json.bounty.paidAt).toBe(blockTimeIso);
    expect(setPaidMock).toHaveBeenCalledWith({}, BOUNTY_ID, TXID, blockTimeIso);
  });

  it("rejects with 422 invalid_state when on-chain payment landed at or after acceptedAt + PAY_GRACE_MS", async () => {
    const acceptedAt = new Date(Date.now() - PAY_GRACE_MS - 86_400_000).toISOString();
    // Paid exactly at the upper boundary (half-open: >= acceptedAt + PAY_GRACE_MS is late).
    const lateBlockTimeIso = new Date(Date.parse(acceptedAt) + PAY_GRACE_MS).toISOString();
    const bounty = makeBounty({ acceptedAt, updatedAt: acceptedAt });

    getBountyMock.mockResolvedValue(bounty);
    verifyPayoutTxidMock.mockResolvedValue({
      ok: true,
      canonicalTxid: TXID,
      blockTimeIso: lateBlockTimeIso,
    });

    const res = await POST(paidRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string; status: string };
    expect(json.error).toBe("invalid_state");
    expect(json.status).toBe("abandoned");
    expect(json.message).toContain("pay-grace window closed");
    expect(setPaidMock).not.toHaveBeenCalled();
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
    expect(setPaidMock).not.toHaveBeenCalled();
  });
});
