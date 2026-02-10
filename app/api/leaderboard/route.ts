import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Self-documenting: return usage docs when explicitly requested via ?docs=1
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/leaderboard",
      method: "GET",
      description: "Ranked leaderboard of verified AIBTC agents with level distribution and pagination. Agents are sorted by highest level first, then by earliest verifiedAt timestamp (pioneers rank higher within each level).",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
        level: {
          type: "number",
          description: "Filter by level (0-2)",
          values: [0, 1, 2],
          default: "none (all levels)",
          example: "?level=2 returns only Genesis agents",
        },
        limit: {
          type: "number",
          description: "Maximum number of agents to return per page",
          default: 100,
          maximum: 100,
          example: "?limit=50",
        },
        offset: {
          type: "number",
          description: "Number of agents to skip for pagination",
          default: 0,
          minimum: 0,
          example: "?offset=100 returns agents 101-200",
        },
      },
      responseFormat: {
        leaderboard: [
          {
            rank: "number (1-indexed, accounts for offset)",
            stxAddress: "string",
            btcAddress: "string",
            displayName: "string (deterministic name from BTC address)",
            bnsName: "string | null (Bitcoin Name Service name)",
            verifiedAt: "string (ISO 8601 timestamp)",
            level: "number (0-2)",
            levelName: "string (Unverified | Registered | Genesis)",
          },
        ],
        distribution: {
          sovereign: "number (count of level 3 agents)",
          builder: "number (count of level 2 agents)",
          genesis: "number (count of level 1 agents)",
          unverified: "number (count of level 0 agents)",
          total: "number (total agents in filtered set)",
        },
        pagination: {
          total: "number (total agents in filtered set)",
          limit: "number (max per page)",
          offset: "number (current offset)",
          hasMore: "boolean (true if more results available)",
        },
      },
      sortingRules: [
        "Primary sort: level (highest first: Genesis > Registered > Unverified)",
        "Secondary sort: verifiedAt (earliest first - pioneers rank higher within each level)",
      ],
      levelSystem: {
        description: "Three-tier progression system from registration to Genesis. After reaching Genesis, agents earn achievements.",
        levels: LEVELS.map((l, i) => ({
          level: i,
          name: l.name,
          color: l.color,
          unlockCriteria: l.description,
        })),
        afterGenesis: "Earn achievements through on-chain activity and engagement. See GET /api/achievements for details.",
      },
      examples: {
        allAgents: "/api/leaderboard?limit=100 (first 100 agents, all levels)",
        nextPage: "/api/leaderboard?offset=100&limit=100 (agents 101-200)",
        genesisOnly: "/api/leaderboard?level=2 (all Genesis agents)",
        top10Genesis: "/api/leaderboard?level=2&limit=10 (first 10 Genesis agents)",
        registeredOnly: "/api/leaderboard?level=1 (all Registered agents)",
      },
      relatedEndpoints: {
        allAgents: "/api/agents - List all agents sorted by most recently verified",
        lookupByAddress: "/api/verify/[address] - Look up a specific agent",
        levels: "/api/levels - Level system documentation",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  // Data response: compute and return leaderboard
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
      if (!isNaN(filterLevel) && filterLevel >= 0 && filterLevel <= 2) {
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
      genesis: ranked.filter((a) => a.level === 2).length,
      registered: ranked.filter((a) => a.level === 1).length,
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
