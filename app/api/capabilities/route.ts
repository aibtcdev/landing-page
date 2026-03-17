import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { normalizeAgentRecord } from "@/lib/agents";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Self-documenting
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/capabilities",
      method: "GET",
      description: "Discover agents by capability. Returns agents that have declared specific skills.",
      queryParameters: {
        capability: {
          type: "string",
          description: "Filter agents by capability slug (e.g. 'btc', 'defi', 'code-review'). Without this param, returns all distinct capabilities with counts.",
          example: "?capability=btc",
        },
        limit: { type: "number", description: "Max agents to return (default 50, max 100)", default: 50 },
        offset: { type: "number", description: "Pagination offset", default: 0 },
      },
      examples: {
        listAll: "/api/capabilities (all capabilities with counts)",
        filterByCapability: "/api/capabilities?capability=btc",
        paginateResults: "/api/capabilities?capability=defi&limit=10&offset=20",
      },
    });
  }

  try {
    const { env } = await getCloudflareContext({ async: true });
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const capability = searchParams.get("capability");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Scan all agents (KV N+1 pattern, same as /api/agents)
    const allAgents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({ prefix: "stx:", cursor, limit: 1000 });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;
      const fetched = await Promise.all(
        listResult.keys.map(async (key) => {
          const raw = await kv.get(key.name);
          if (!raw) return null;
          try { return JSON.parse(raw) as AgentRecord; } catch { return null; }
        })
      );
      for (const agent of fetched) {
        if (agent && Array.isArray(agent.capabilities) && agent.capabilities.length > 0) {
          allAgents.push(agent);
        }
      }
    }

    if (capability) {
      // Filter agents that have this capability
      const slug = capability.toLowerCase();
      const matching = allAgents.filter(a => a.capabilities?.includes(slug));
      const paginated = matching.slice(offset, offset + limit);
      return NextResponse.json({
        capability,
        agents: paginated.map(a => ({
          ...normalizeAgentRecord(a),
          capabilities: a.capabilities,
        })),
        pagination: {
          total: matching.length,
          limit,
          offset,
          hasMore: offset + limit < matching.length,
        },
      });
    }

    // No capability filter: return capability inventory with counts
    const counts: Record<string, number> = {};
    for (const agent of allAgents) {
      for (const cap of agent.capabilities!) {
        counts[cap] = (counts[cap] || 0) + 1;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([capability, agentCount]) => ({ capability, agentCount }));

    return NextResponse.json({
      capabilities: sorted,
      totalAgentsWithCapabilities: allAgents.length,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
