import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { normalizeAgentRecord } from "@/lib/agents";
import { getAgentsIndex, type AgentIndexEntry } from "@/lib/agents-index";

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

    // Source capabilities + addresses from the maintained agents:index
    // (single KV read), then only fetch full AgentRecords for the
    // paginated slice that's actually returned.
    const index = await getAgentsIndex(kv);
    const indexed: AgentIndexEntry[] = index.agents.filter(
      (e) => Array.isArray(e.capabilities) && e.capabilities.length > 0,
    );

    if (capability) {
      const slug = capability.toLowerCase();
      const matching = indexed.filter((e) => e.capabilities?.includes(slug));
      const paginated = matching.slice(offset, offset + limit);

      const records = await Promise.all(
        paginated.map(async (entry) => {
          const raw = await kv.get(`btc:${entry.btcAddress}`);
          if (!raw) return null;
          try { return JSON.parse(raw) as AgentRecord; } catch { return null; }
        }),
      );

      return NextResponse.json({
        capability,
        agents: records
          .filter((a): a is AgentRecord => a !== null)
          .map((a) => ({
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

    // No filter: capability inventory + counts. Computed entirely
    // from the slim index — no per-agent record fetch needed.
    const counts: Record<string, number> = {};
    for (const entry of indexed) {
      for (const cap of entry.capabilities!) {
        counts[cap] = (counts[cap] || 0) + 1;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([capability, agentCount]) => ({ capability, agentCount }));

    return NextResponse.json({
      capabilities: sorted,
      totalAgentsWithCapabilities: indexed.length,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
