import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import {
  getReputationSummary,
  getReputationFeedback,
} from "@/lib/identity/reputation";

/**
 * Look up an agent by BTC or STX address.
 * Try both keys in parallel for efficiency.
 */
async function lookupAgent(
  kv: KVNamespace,
  address: string
): Promise<AgentRecord | null> {
  const [btcData, stxData] = await Promise.all([
    kv.get(`btc:${address}`),
    kv.get(`stx:${address}`),
  ]);

  const data = btcData || stxData;
  if (!data) return null;

  try {
    return JSON.parse(data) as AgentRecord;
  } catch {
    return null;
  }
}

/**
 * GET /api/identity/:address/reputation — Fetch on-chain reputation data.
 *
 * Runs Stacks API calls server-side where the in-memory cache works
 * properly and CORS is not a concern.
 *
 * Query parameters:
 *   type=summary  — Returns ReputationSummary for the agent
 *   type=feedback — Returns paginated ReputationFeedback list
 *   cursor=N      — Pagination cursor for feedback (optional)
 *
 * Without query params, returns self-documenting usage information.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  // Self-documenting response when no type param is provided
  if (!type) {
    return NextResponse.json({
      endpoint: "/api/identity/[address]/reputation",
      description:
        "Fetch on-chain ERC-8004 reputation data for a registered agent. " +
        "Runs Stacks API calls server-side with caching.",
      parameters: {
        address: "BTC (bc1...) or STX (SP...) address of a registered agent",
        type: "'summary' | 'feedback' (required)",
        cursor: "Pagination cursor for feedback (optional, integer)",
      },
      examples: [
        "GET /api/identity/bc1q.../reputation?type=summary",
        "GET /api/identity/bc1q.../reputation?type=feedback",
        "GET /api/identity/bc1q.../reputation?type=feedback&cursor=10",
      ],
    });
  }

  if (type !== "summary" && type !== "feedback") {
    return NextResponse.json(
      { error: "Invalid type parameter. Use 'summary' or 'feedback'." },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY;

    const agent = await lookupAgent(kv, address);

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", address },
        { status: 404 }
      );
    }

    if (agent.erc8004AgentId === undefined || agent.erc8004AgentId === null) {
      return NextResponse.json(
        {
          error: "Agent has no on-chain identity",
          hint: "Register on-chain identity first via the ERC-8004 identity registry",
        },
        { status: 404 }
      );
    }

    const agentId = agent.erc8004AgentId;

    if (type === "summary") {
      const summary = await getReputationSummary(agentId, hiroApiKey, kv);
      return NextResponse.json(
        { summary },
        {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=300",
          },
        }
      );
    }

    // type === "feedback"
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;
    const feedback = await getReputationFeedback(agentId, cursor, hiroApiKey, kv);
    return NextResponse.json(
      { feedback },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Reputation fetch failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
