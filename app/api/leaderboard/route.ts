import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const levelFilter = searchParams.get("level");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 100) : 100;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Load all agents
    const agents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({
        prefix: "stx:",
        cursor,
      });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;

      const values = await Promise.all(
        listResult.keys.map(async (key) => {
          const value = await kv.get(key.name);
          if (!value) return null;
          try {
            return JSON.parse(value) as AgentRecord;
          } catch {
            return null;
          }
        })
      );
      agents.push(...values.filter((v): v is AgentRecord => v !== null));
    }

    // Look up claims for all agents
    const claims = await Promise.all(
      agents.map(async (agent) => {
        const claimData = await kv.get(`claim:${agent.btcAddress}`);
        if (!claimData) return null;
        try {
          return JSON.parse(claimData) as ClaimStatus;
        } catch {
          return null;
        }
      })
    );

    // Compute levels and build ranked list
    let ranked = agents.map((agent, i) => {
      const level = computeLevel(agent, claims[i]);
      return {
        stxAddress: agent.stxAddress,
        btcAddress: agent.btcAddress,
        displayName: agent.displayName,
        bnsName: agent.bnsName,
        verifiedAt: agent.verifiedAt,
        level,
        levelName: LEVELS[level].name,
      };
    });

    // Filter by level if requested
    if (levelFilter !== null) {
      const filterLevel = parseInt(levelFilter, 10);
      if (!isNaN(filterLevel) && filterLevel >= 0 && filterLevel <= 3) {
        ranked = ranked.filter((a) => a.level === filterLevel);
      }
    }

    // Sort: highest level first, then earliest verifiedAt (pioneers rank higher)
    ranked.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return new Date(a.verifiedAt).getTime() - new Date(b.verifiedAt).getTime();
    });

    // Level distribution stats
    const distribution = {
      sovereign: ranked.filter((a) => a.level === 3).length,
      builder: ranked.filter((a) => a.level === 2).length,
      genesis: ranked.filter((a) => a.level === 1).length,
      unverified: ranked.filter((a) => a.level === 0).length,
      total: ranked.length,
    };

    // Paginate
    const paginated = ranked.slice(offset, offset + limit);

    // Add rank numbers (1-indexed, accounting for offset)
    const withRanks = paginated.map((agent, i) => ({
      rank: offset + i + 1,
      ...agent,
    }));

    return NextResponse.json(
      {
        leaderboard: withRanks,
        distribution,
        pagination: {
          total: ranked.length,
          limit,
          offset,
          hasMore: offset + limit < ranked.length,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=120",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch leaderboard: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
