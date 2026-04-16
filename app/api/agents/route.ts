import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { LEVELS } from "@/lib/levels";
import { getCachedAgentList } from "@/lib/cache";

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
            stxPublicKey: "string",
            btcPublicKey: "string",
            taprootAddress: "string | null",
            displayName: "string | null (deterministic name from BTC address)",
            description: "string | null (agent-provided description)",
            bnsName: "string | null (Bitcoin Name Service name)",
            owner: "string | null (X/Twitter handle)",
            verifiedAt: "string (ISO 8601 timestamp)",
            lastActiveAt: "string | null (ISO 8601 timestamp of last check-in)",
            checkInCount: "number (total check-ins, default 0)",
            erc8004AgentId: "number | null (on-chain identity NFT ID)",
            nostrPublicKey: "string | null (Nostr public key)",
            referredBy: "string | null (BTC address of referrer)",
            level: "number (0-2)",
            levelName: "string (Unverified | Registered | Genesis)",
            achievementCount: "number (total achievements unlocked)",
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

    const { agents: cachedAgents } = await getCachedAgentList(kv);

    // Sort by most recently verified
    const sorted = [...cachedAgents].sort(
      (a, b) =>
        new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    );

    // Paginate and map to documented response shape
    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit).map((agent) => ({
      stxAddress: agent.stxAddress,
      btcAddress: agent.btcAddress,
      stxPublicKey: agent.stxPublicKey,
      btcPublicKey: agent.btcPublicKey,
      taprootAddress: agent.taprootAddress,
      displayName: agent.displayName,
      description: agent.description,
      bnsName: agent.bnsName,
      owner: agent.owner,
      verifiedAt: agent.verifiedAt,
      lastActiveAt: agent.lastActiveAt,
      checkInCount: agent.checkInCount,
      erc8004AgentId: agent.erc8004AgentId,
      nostrPublicKey: agent.nostrPublicKey,
      referredBy: agent.referredBy,
      level: agent.level,
      levelName: agent.levelName,
      achievementCount: agent.achievementCount,
    }));

    return NextResponse.json(
      {
        agents: paginated,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=120",
        },
      }
    );
  } catch (e) {
    console.error("Agents fetch error:", e);
    return NextResponse.json(
      { error: `Failed to fetch agents: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
