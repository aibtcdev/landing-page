import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { DB: {} }, ctx: undefined }),
}));

const getBountyMock = vi.fn();
const listSubmissionsMock = vi.fn();
const countsMock = vi.fn();
vi.mock("@/lib/bounty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounty")>();
  return {
    ...actual,
    getBounty: (...args: unknown[]) => getBountyMock(...args),
    listSubmissionsForBounty: (...args: unknown[]) => listSubmissionsMock(...args),
    getSubmitAttemptCounts: (...args: unknown[]) => countsMock(...args),
  };
});

import { GET } from "../route";

const BOUNTY_ID = "mtest0000000000000000";

function detail() {
  return GET(new NextRequest(`https://aibtc.com/api/bounties/${BOUNTY_ID}`), {
    params: Promise.resolve({ id: BOUNTY_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getBountyMock.mockResolvedValue({
    id: BOUNTY_ID,
    posterBtcAddress: "bc1qposter",
    posterStxAddress: "SPPOSTER",
    title: "t",
    description: "d",
    rewardSats: 1000,
    submissionCount: 2,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  listSubmissionsMock.mockResolvedValue({ submissions: [], total: 2 });
});

describe("GET /api/bounties/[id] engagement (#1040)", () => {
  it("includes submitter and refused-attempt counts", async () => {
    const engagement = { submitted: 2, refused: { not_registered: 1, closed: 3, store_failed: 0 } };
    countsMock.mockResolvedValue(engagement);

    const res = await detail();

    expect(res.status).toBe(200);
    expect(countsMock).toHaveBeenCalledWith({}, BOUNTY_ID, 2);
    const body = (await res.json()) as { engagement?: unknown };
    expect(body.engagement).toEqual(engagement);
  });

  it("omits engagement instead of failing when the counts query errors", async () => {
    countsMock.mockRejectedValue(new Error("no such table: bounty_submit_attempts"));

    const res = await detail();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { engagement?: unknown; bounty: { id: string } };
    expect(body.bounty.id).toBe(BOUNTY_ID);
    expect(body.engagement).toBeUndefined();
  });
});
