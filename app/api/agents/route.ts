import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { lookupBnsName } from "@/lib/bns";

export async function GET(request: NextRequest) {
  // Self-documenting: return usage docs when explicitly requested via ?docs=1
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/agents",
      method: "GET",
      description: "List all verified AIBTC agents with level information. Returns agents sorted by most recently verified.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
        limit: {
          type: "number",
          description: "Maximum number of agents to return per page",
          default: 50,
          maximum: 100,
          example: "?limit=100",
        },
        offset: {
          type: "number",
          description: "Number of agents to skip for pagination",
          default: 0,
          minimum: 0,
          example: "?offset=50",
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
            level: "number (0-2)",
            levelName: "string (Unverified | Registered | Genesis)",
            stxPublicKey: "string",
            btcPublicKey: "string",
            lastActiveAt: "string | undefined (ISO 8601 timestamp of last check-in)",
            checkInCount: "number | undefined (total check-ins)",
          },
        ],
        pagination: {
          total: "number (total agents in dataset)",
          limit: "number (max per page)",
          offset: "number (current offset)",
          hasMore: "boolean (true if more results available)",
        },
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
      examples: {
        firstPage: "/api/agents?limit=50 (first 50 agents)",
        nextPage: "/api/agents?offset=50&limit=50 (agents 51-100)",
        allAgents: "/api/agents?limit=100 (max 100 per page)",
      },
      relatedEndpoints: {
        lookupByAddress: "/api/agents/:address - Look up a specific agent by BTC/STX address or BNS name",
        verify: "/api/verify/:address - Legacy verification endpoint",
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

  // Data response: list all agents with pagination
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const limit = limitParam
    ? Math.min(parseInt(limitParam, 10) || 50, 100)
    : 50;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

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
        cursor,
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

    // Lazy BNS refresh: for agents without bnsName but with stxAddress,
    // attempt BNS lookup and persist if found. Capped to avoid excessive
    // external API calls, and fire-and-forget so it doesn't block the response.
    const hiroApiKey = env.HIRO_API_KEY;
    const MAX_BNS_REFRESH_PER_REQUEST = 10;
    const agentsNeedingBns = agents.filter(
      (agent) => !agent.bnsName && agent.stxAddress
    );
    if (agentsNeedingBns.length > 0) {
      const batch = agentsNeedingBns.slice(0, MAX_BNS_REFRESH_PER_REQUEST);
      void Promise.allSettled(
        batch.map(async (agent) => {
          const bnsName = await lookupBnsName(agent.stxAddress!, hiroApiKey, kv);
          if (bnsName) {
            agent.bnsName = bnsName;
            const updated = JSON.stringify(agent);
            await Promise.all([
              kv.put(`stx:${agent.stxAddress}`, updated),
              kv.put(`btc:${agent.btcAddress}`, updated),
            ]);
          }
        })
      );
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

    // Paginate
    const total = agentsWithLevels.length;
    const paginated = agentsWithLevels.slice(offset, offset + limit);

    return NextResponse.json({
      agents: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch agents: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
