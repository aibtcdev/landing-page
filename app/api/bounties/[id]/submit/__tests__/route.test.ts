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

const lookupAgentMock = vi.fn();
vi.mock("@/lib/agent-lookup", () => ({
  lookupAgent: (...args: unknown[]) => lookupAgentMock(...args),
}));

const verifySignatureMock = vi.fn();
vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: (...args: unknown[]) => verifySignatureMock(...args),
}));

const getBountyMock = vi.fn();
const enteredAgentsMock = vi.fn();
const listMembersMock = vi.fn();
const insertSubmissionMock = vi.fn();
const recordSubmitAttemptMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  // Keep the pure helpers (validation, message building, status derivation,
  // id generation) real — only the D1 readers/writers are stubbed.
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    enteredAgents: (...args: unknown[]) => enteredAgentsMock(...args),
    listMembers: (...args: unknown[]) => listMembersMock(...args),
    insertSubmission: (...args: unknown[]) => insertSubmissionMock(...args),
    recordSubmitAttempt: (...args: unknown[]) => recordSubmitAttemptMock(...args),
  };
});

import { POST } from "../route";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBMITTER_BTC = "bc1qsubmitter000000000000000000000000000000";
const POSTER_BTC = "bc1qposter0000000000000000000000000000000000";
const BOUNTY_ID = "mtest0000000000000000";

function openBounty() {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: BOUNTY_ID,
    posterBtcAddress: POSTER_BTC,
    title: "Test bounty",
    description: "Do the thing",
    rewardSats: 5000,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: future,
    submissionCount: 0,
  };
}

const MATE1_BTC = "bc1qmateone00000000000000000000000000000000";
const MATE2_BTC = "bc1qmatetwo00000000000000000000000000000000";

function submitRequest(extra: Record<string, unknown> = {}) {
  const body = {
    ...extra,
    submitterBtcAddress: SUBMITTER_BTC,
    message: "Here is my work.",
    contentUrl: "https://example.com/pr/1",
    signedAt: new Date().toISOString(),
    // Non-hex chars so format validation treats it as base64 (≥86 chars),
    // not as a (130-char) hex signature. Verification itself is mocked.
    signature: "G".repeat(88),
  };
  return new NextRequest(`https://aibtc.com/api/bounties/${BOUNTY_ID}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupAgentMock.mockImplementation(async (_kv: unknown, addr: string) => ({
    btcAddress: addr,
    stxAddress: `SP-${addr}`,
  }));
  verifySignatureMock.mockReturnValue({ valid: true, address: SUBMITTER_BTC });
  getBountyMock.mockResolvedValue(openBounty());
  enteredAgentsMock.mockResolvedValue(new Set());
  listMembersMock.mockResolvedValue(new Map());
  insertSubmissionMock.mockResolvedValue(undefined);
  recordSubmitAttemptMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/bounties/[id]/submit — one submission per agent", () => {
  it("first submission from an agent is accepted (201)", async () => {
    const res = await POST(submitRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(201);
    expect(enteredAgentsMock).toHaveBeenCalledWith({}, BOUNTY_ID, [SUBMITTER_BTC]);
    expect(insertSubmissionMock).toHaveBeenCalledTimes(1);
  });

  it("repeat submission from the same agent is rejected (409 already_submitted)", async () => {
    enteredAgentsMock.mockResolvedValue(new Set([SUBMITTER_BTC]));

    const res = await POST(submitRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_submitted");
    expect(insertSubmissionMock).not.toHaveBeenCalled();
  });

  it("closed bounty wins over the duplicate check (422 before 409)", async () => {
    // Expired bounty: derived status is `judging`, not `open`.
    getBountyMock.mockResolvedValue({
      ...openBounty(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    enteredAgentsMock.mockResolvedValue(new Set([SUBMITTER_BTC]));

    const res = await POST(submitRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("submissions_closed");
  });

  it("scheduled bounty refuses entries (422) and returns opening time (#1113)", async () => {
    const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    getBountyMock.mockResolvedValue({
      ...openBounty(),
      opensAt,
    });

    const res = await POST(submitRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      status: string;
      opensAt?: string;
      message: string;
    };
    expect(body.error).toBe("submissions_closed");
    expect(body.status).toBe("scheduled");
    expect(body.opensAt).toBe(opensAt);
    expect(body.message).toContain(opensAt);
    expect(insertSubmissionMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/bounties/[id]/submit: refused attempts are recorded (#1040)", () => {
  const call = () => POST(submitRequest(), { params: Promise.resolve({ id: BOUNTY_ID }) });

  it("does not record anything on a successful submission", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(recordSubmitAttemptMock).not.toHaveBeenCalled();
  });

  it("records not_registered when the signer has no agent record", async () => {
    lookupAgentMock.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(recordSubmitAttemptMock).toHaveBeenCalledWith(
      {}, BOUNTY_ID, SUBMITTER_BTC, "not_registered", expect.any(String)
    );
  });

  it("records closed when the bounty is no longer open", async () => {
    getBountyMock.mockResolvedValue({
      ...openBounty(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await call();
    expect(res.status).toBe(422);
    expect(recordSubmitAttemptMock).toHaveBeenCalledWith(
      {}, BOUNTY_ID, SUBMITTER_BTC, "closed", expect.any(String)
    );
  });

  it("records store_failed when the insert throws", async () => {
    insertSubmissionMock.mockRejectedValue(new Error("D1 down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(recordSubmitAttemptMock).toHaveBeenCalledWith(
      {}, BOUNTY_ID, SUBMITTER_BTC, "store_failed", expect.any(String)
    );
  });

  it("does not record when the signature fails (signer is unproven)", async () => {
    verifySignatureMock.mockReturnValue({ valid: false, address: "bc1qsomeoneelse" });
    const res = await call();
    expect(res.status).toBe(400);
    expect(recordSubmitAttemptMock).not.toHaveBeenCalled();
  });

  it("still returns the original refusal when recording fails", async () => {
    lookupAgentMock.mockResolvedValue(null);
    recordSubmitAttemptMock.mockRejectedValue(new Error("table missing"));
    const res = await call();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("agent_not_found");
  });
});

describe("POST /api/bounties/[id]/submit: team entries", () => {
  const call = (extra: Record<string, unknown>) =>
    POST(submitRequest(extra), { params: Promise.resolve({ id: BOUNTY_ID }) });

  it("stores the team with an even split, lead first, STX addresses from agent records", async () => {
    const res = await call({ teammates: [MATE1_BTC, MATE2_BTC] });
    expect(res.status).toBe(201);
    const members = insertSubmissionMock.mock.calls[0][3];
    expect(members).toEqual([
      { btcAddress: SUBMITTER_BTC, stxAddress: `SP-${SUBMITTER_BTC}`, shareSats: 1668 },
      { btcAddress: MATE1_BTC, stxAddress: `SP-${MATE1_BTC}`, shareSats: 1666 },
      { btcAddress: MATE2_BTC, stxAddress: `SP-${MATE2_BTC}`, shareSats: 1666 },
    ]);
    expect(insertSubmissionMock.mock.calls[0][1].teamSize).toBe(3);
  });

  it("signs over the teammates: the submit message ends with them in order", async () => {
    await call({ teammates: [MATE2_BTC, MATE1_BTC] });
    const signed = verifySignatureMock.mock.calls[0][1] as string;
    expect(signed.endsWith(` | ${MATE2_BTC},${MATE1_BTC}`)).toBe(true);
  });

  it("tells the lead which teammates still have to confirm", async () => {
    listMembersMock.mockImplementation(async (_db: unknown, [id]: string[]) =>
      new Map([
        [
          id,
          [
            { btcAddress: SUBMITTER_BTC, stxAddress: "SP1", role: "lead", shareSats: 2500, confirmed: true },
            { btcAddress: MATE1_BTC, stxAddress: "SP2", role: "member", shareSats: 2500, confirmed: false },
          ],
        ],
      ])
    );
    const res = await call({ teammates: [MATE1_BTC] });
    const json = (await res.json()) as {
      submission: { teamStatus: string };
      nextStep: { confirmEndpoint: string; description: string };
    };
    expect(json.submission.teamStatus).toBe("pending");
    expect(json.nextStep.description).toContain(MATE1_BTC);
    expect(json.nextStep.confirmEndpoint).toMatch(/\/submissions\/.+\/confirm$/);
  });

  it("refuses an unregistered teammate (404) and stores nothing", async () => {
    lookupAgentMock.mockImplementation(async (_kv: unknown, addr: string) =>
      addr === MATE1_BTC ? null : { btcAddress: addr, stxAddress: `SP-${addr}` }
    );
    const res = await call({ teammates: [MATE1_BTC] });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string; addresses: string[] };
    expect(json).toMatchObject({ error: "teammate_not_registered", addresses: [MATE1_BTC] });
    expect(insertSubmissionMock).not.toHaveBeenCalled();
  });

  it("refuses the poster as a teammate", async () => {
    const res = await call({ teammates: [POSTER_BTC] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("teammate_is_poster");
  });

  it("refuses a teammate who already entered this bounty (409)", async () => {
    enteredAgentsMock.mockResolvedValue(new Set([MATE1_BTC]));
    const res = await call({ teammates: [MATE1_BTC] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string; addresses: string[] })).toMatchObject({
      error: "teammate_already_entered",
      addresses: [MATE1_BTC],
    });
  });

  it("maps a concurrent unique-index refusal to 409, not a storage failure", async () => {
    insertSubmissionMock.mockRejectedValue(new Error("D1_ERROR: UNIQUE constraint failed"));
    const res = await call({ teammates: [MATE1_BTC] });
    expect(res.status).toBe(409);
    expect(recordSubmitAttemptMock).not.toHaveBeenCalled();
  });

  it("refuses a team larger than the reward in sats", async () => {
    getBountyMock.mockResolvedValue({ ...openBounty(), rewardSats: 2 });
    const res = await call({ teammates: [MATE1_BTC, MATE2_BTC] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("team_too_large");
  });
});
