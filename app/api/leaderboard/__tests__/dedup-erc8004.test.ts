import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Mock the Cloudflare context + cached agent list the route reads from.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({
  getCachedAgentList: vi.fn(),
}));

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCachedAgentList } from "@/lib/cache";
import { GET as leaderboardGET } from "../route";

/** Minimal cached-agent fixture; only the fields the route reads matter. */
function agent(overrides: Record<string, unknown>) {
  return {
    stxAddress: "SP_PLACEHOLDER",
    btcAddress: "bc1placeholder",
    stxPublicKey: null,
    btcPublicKey: null,
    taprootAddress: null,
    displayName: "Agent",
    description: null,
    bnsName: null,
    owner: null,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null,
    erc8004AgentId: null,
    nostrPublicKey: null,
    referredBy: null,
    level: 1,
    levelName: "Registered",
    ...overrides,
  };
}

function req(query = "") {
  return new NextRequest(`https://aibtc.com/api/leaderboard${query}`);
}

interface LeaderboardBody {
  leaderboard: Array<{
    erc8004AgentId: number | null;
    btcAddress: string;
    displayName: string;
    level: number;
    levelName: string;
  }>;
  pagination: { total: number };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getCloudflareContext as Mock).mockResolvedValue({
    env: { VERIFIED_AGENTS: {} },
  });
});

describe("/api/leaderboard — dedupe by erc8004AgentId (#820)", () => {
  it("collapses two rotated wallets sharing an agent-id into one row (current display, max level)", async () => {
    (getCachedAgentList as Mock).mockResolvedValue({
      agents: [
        // Old / Genesis wallet — earlier verifiedAt, level 2.
        agent({
          stxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
          btcAddress: "bc1qqaxq5vxszt0lzmr9gskv4lcx7jzrg772s4vxpp",
          displayName: "Secret Mars",
          verifiedAt: "2026-02-05T00:00:00.000Z",
          erc8004AgentId: 5,
          level: 2,
          levelName: "Genesis",
        }),
        // Current wallet — later verifiedAt, only level 1.
        agent({
          stxAddress: "SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1",
          btcAddress: "bc1qxhjvcm",
          displayName: "Quasar Garuda",
          verifiedAt: "2026-04-18T00:00:00.000Z",
          erc8004AgentId: 5,
          level: 1,
          levelName: "Verified Agent",
        }),
      ],
    });

    const resp = await leaderboardGET(req());
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as LeaderboardBody;

    const five = body.leaderboard.filter((r) => r.erc8004AgentId === 5);
    // Exactly one row for the shared identity, not two.
    expect(five).toHaveLength(1);
    // Display comes from the most recently verified (current) wallet...
    expect(five[0].btcAddress).toBe("bc1qxhjvcm");
    expect(five[0].displayName).toBe("Quasar Garuda");
    // ...but the level/levelName is the max across the rotation chain.
    expect(five[0].level).toBe(2);
    expect(five[0].levelName).toBe("Genesis");
  });

  it("leaves agents without an erc8004AgentId untouched (no false collapsing)", async () => {
    (getCachedAgentList as Mock).mockResolvedValue({
      agents: [
        agent({ stxAddress: "SP_A", btcAddress: "bc1a", erc8004AgentId: null }),
        agent({ stxAddress: "SP_B", btcAddress: "bc1b", erc8004AgentId: null }),
        agent({ stxAddress: "SP_C", btcAddress: "bc1c", erc8004AgentId: 7 }),
      ],
    });

    const resp = await leaderboardGET(req());
    const body = (await resp.json()) as LeaderboardBody;
    // All three distinct rows survive — null identity is never a duplicate.
    expect(body.leaderboard).toHaveLength(3);
    expect(body.pagination.total).toBe(3);
  });
});
