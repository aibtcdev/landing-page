import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { detectAgentIdentity } from "@/lib/identity/detection";
import { IDENTITY_CHECK_TTL_MS } from "@/lib/identity/constants";

/**
 * GET /api/identity/:address — Detect on-chain ERC-8004 identity for an agent.
 *
 * Runs the O(N) identity scan server-side so clients avoid CORS issues and
 * sequential Stacks API calls from the browser. If found, persists the
 * agentId back to KV on both btc: and stx: keys for future lookups.
 * If not found, persists `erc8004AgentId: null` with a `lastIdentityCheck`
 * timestamp to avoid repeating the scan on every profile view.
 *
 * Returns: { agentId: number | null }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || address.trim().length === 0) {
    return NextResponse.json(
      {
        endpoint: "/api/identity/[address]",
        description:
          "Detect on-chain ERC-8004 identity for a registered agent. " +
          "Scans the identity registry contract server-side and caches " +
          "the result in KV.",
        parameters: {
          address:
            "BTC (bc1...) or STX (SP...) address of a registered agent",
        },
        response: {
          agentId: "number | null — the on-chain NFT token ID, or null if not registered",
        },
        example: "GET /api/identity/bc1q...",
      },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const agent = await lookupAgent(kv, address);

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", address },
        { status: 404 }
      );
    }

    // If a positive result is already stored, return immediately
    if (agent.erc8004AgentId !== undefined && agent.erc8004AgentId !== null) {
      return NextResponse.json(
        { agentId: agent.erc8004AgentId },
        {
          headers: {
            "Cache-Control": "public, max-age=300, s-maxage=600",
          },
        }
      );
    }

    // Negative cache: if we recently checked and found nothing, skip the scan
    if (
      agent.erc8004AgentId === null &&
      agent.lastIdentityCheck &&
      Date.now() - new Date(agent.lastIdentityCheck).getTime() < IDENTITY_CHECK_TTL_MS
    ) {
      return NextResponse.json(
        { agentId: null },
        {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=120",
          },
        }
      );
    }

    // Run the identity scan server-side
    const identity = await detectAgentIdentity(agent.stxAddress);

    // Persist the result (positive or negative) to KV on both keys
    agent.erc8004AgentId = identity ? identity.agentId : null;
    agent.lastIdentityCheck = new Date().toISOString();
    const updated = JSON.stringify(agent);
    await Promise.all([
      kv.put(`stx:${agent.stxAddress}`, updated),
      kv.put(`btc:${agent.btcAddress}`, updated),
    ]);

    if (identity) {
      return NextResponse.json(
        { agentId: identity.agentId },
        {
          headers: {
            "Cache-Control": "public, max-age=300, s-maxage=600",
          },
        }
      );
    }

    return NextResponse.json(
      { agentId: null },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=120",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Identity detection failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
