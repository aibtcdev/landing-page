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
const hasSubmissionMock = vi.fn();
const insertSubmissionMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  // Keep the pure helpers (validation, message building, status derivation,
  // id generation) real — only the D1 readers/writers are stubbed.
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    hasSubmission: (...args: unknown[]) => hasSubmissionMock(...args),
    insertSubmission: (...args: unknown[]) => insertSubmissionMock(...args),
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

function submitRequest() {
  const body = {
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
  lookupAgentMock.mockResolvedValue({
    btcAddress: SUBMITTER_BTC,
    stxAddress: "SPSUBMITTER",
  });
  verifySignatureMock.mockReturnValue({ valid: true, address: SUBMITTER_BTC });
  getBountyMock.mockResolvedValue(openBounty());
  hasSubmissionMock.mockResolvedValue(false);
  insertSubmissionMock.mockResolvedValue(undefined);
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
    expect(hasSubmissionMock).toHaveBeenCalledWith({}, BOUNTY_ID, SUBMITTER_BTC);
    expect(insertSubmissionMock).toHaveBeenCalledTimes(1);
  });

  it("repeat submission from the same agent is rejected (409 already_submitted)", async () => {
    hasSubmissionMock.mockResolvedValue(true);

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
    hasSubmissionMock.mockResolvedValue(true);

    const res = await POST(submitRequest(), {
      params: Promise.resolve({ id: BOUNTY_ID }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("submissions_closed");
  });
});
