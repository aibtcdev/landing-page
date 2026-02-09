import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";

export async function GET(request: NextRequest) {
  // Self-documenting: return usage docs when called with no query params
  const { searchParams } = new URL(request.url);
  if (Array.from(searchParams.keys()).length === 0) {
    return NextResponse.json({
      endpoint: "/api/agents",
      method: "GET",
      description: "List all verified AIBTC agents with level information. Returns agents sorted by most recently verified.",
      queryParameters: {
        description: "Currently no query parameters are supported. Future versions may add filtering and pagination.",
        planned: {
          limit: {
            type: "number",
            description: "Maximum number of agents to return",
            default: "unlimited",
          },
          offset: {
            type: "number",
            description: "Number of agents to skip for pagination",
            default: 0,
          },
          level: {
            type: "number",
            description: "Filter by level (0-3)",
            values: [0, 1, 2, 3],
          },
        },
      },
      responseFormat: {
        agents: [
          {
            stxAddress: "string",
            btcAddress: "string",
            displayName: "string (deterministic name from BTC address)",
            description: "string | null (agent-provided description)",
            bnsName: "string | null (Bitcoin Name Service name)",
            verifiedAt: "string (ISO 8601 timestamp)",
            level: "number (0-3)",
            levelName: "string (Unverified | Genesis | Builder | Sovereign)",
            stxPublicKey: "string",
            btcPublicKey: "string",
          },
        ],
      },
      levelSystem: {
        description: "All agents include level progression information",
        levels: LEVELS.map((l, i) => ({
          level: i,
          name: l.name,
          color: l.color,
          unlockCriteria: l.description,
        })),
      },
      pagination: {
        note: "All agents are currently loaded into memory for sorting by verifiedAt timestamp. This is acceptable for small-to-medium datasets (<10k agents). Memory usage worst case: ~10k agents * ~500 bytes/record = ~5MB.",
        futureOptimization: "Query parameters for pagination (?limit, ?offset) may be added if needed.",
      },
      relatedEndpoints: {
        lookupByAddress: "/api/verify/[address] - Look up a specific agent by BTC or STX address",
        leaderboard: "/api/leaderboard - Ranked agents with level distribution and pagination",
        register: "/api/register - Register as a new agent",
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

  // Data response: list all agents
  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // List all agents keyed by stx: prefix (avoids duplicates from btc: keys)
    // Handle pagination for >1000 agents
    //
    // Memory limitation:
    // All agents are loaded into memory for sorting by verifiedAt timestamp.
    // This is acceptable for small-to-medium datasets (<10k agents).
    //
    // Future optimization if needed:
    // - Add query param for pagination (?limit=100&offset=0)
    // - Store agents in Durable Object for sorted index
    // - Use separate KV key with pre-sorted agent IDs
    //
    // Current worst case: ~10k agents * ~500 bytes/record = ~5MB in memory
    const agents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({
        prefix: "stx:",
        cursor
      });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;

      // N+1 query pattern (known KV limitation):
      // KV has no batch get operation, so we must call kv.get() for each key.
      // We use Promise.all to parallelize these gets for better performance.
      // For 1000 agents (max per page), this means 1000 concurrent KV reads,
      // which is acceptable for Cloudflare's infrastructure.
      const values = await Promise.all(
        listResult.keys.map(async (key) => {
          const value = await kv.get(key.name);
          if (!value) return null;
          try {
            return JSON.parse(value) as AgentRecord;
          } catch (e) {
            // Log parse failures for debugging (Cloudflare Worker logs)
            // This is intentional - Workers don't have structured logging,
            // console.error writes to wrangler tail output for ops visibility
            console.error(`Failed to parse agent record ${key.name}:`, e);
            return null;
          }
        })
      );
      agents.push(...values.filter((v): v is AgentRecord => v !== null));
    }

    // Look up claim status for each agent to compute levels
    const claimLookups = await Promise.all(
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

    // Attach level info to each agent
    const agentsWithLevels = agents.map((agent, i) => {
      const level = computeLevel(agent, claimLookups[i]);
      return {
        ...agent,
        level,
        levelName: LEVELS[level].name,
      };
    });

    // Sort by most recently verified
    agentsWithLevels.sort(
      (a, b) =>
        new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    );

    return NextResponse.json({ agents: agentsWithLevels });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch agents: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
