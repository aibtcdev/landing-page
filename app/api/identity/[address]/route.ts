import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { detectAgentIdentity } from "@/lib/identity/detection";

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
 * GET /api/identity/:address — Detect on-chain ERC-8004 identity for an agent.
 *
 * Runs the O(N) identity scan server-side so clients avoid CORS issues and
 * sequential Stacks API calls from the browser. If found, persists the
 * agentId back to KV on both btc: and stx: keys for future lookups.
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

    // If already stored, return immediately
    if (agent.erc8004AgentId !== undefined) {
      return NextResponse.json(
        { agentId: agent.erc8004AgentId },
        {
          headers: {
            "Cache-Control": "public, max-age=300, s-maxage=600",
          },
        }
      );
    }

    // Run the identity scan server-side
    const identity = await detectAgentIdentity(agent.stxAddress);

    if (identity) {
      // Persist to KV on both keys so future lookups are instant
      agent.erc8004AgentId = identity.agentId;
      const updated = JSON.stringify(agent);
      await Promise.all([
        kv.put(`stx:${agent.stxAddress}`, updated),
        kv.put(`btc:${agent.btcAddress}`, updated),
      ]);

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
