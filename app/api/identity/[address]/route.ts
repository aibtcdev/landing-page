import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";

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

    // If we already have a positive result in KV, return it without hitting Hiro
    if (agent.erc8004AgentId != null) {
      return NextResponse.json(
        { agentId: agent.erc8004AgentId },
        { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } }
      );
    }

    // Only fetch from Hiro when agentId is unknown
    const contract = "SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2";
    const assetId = `${contract}::agent-identity`;
    const url = `https://api.mainnet.hiro.so/extended/v1/tokens/nft/holdings?principal=${agent.stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    const headers: Record<string, string> = {};
    if (env.HIRO_API_KEY) headers["X-Hiro-API-Key"] = env.HIRO_API_KEY;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Hiro API error: ${resp.status}` },
        { status: 502 }
      );
    }

    const data = await resp.json() as {
      results?: Array<{ value: { repr: string } }>;
    };

    const repr = data.results?.[0]?.value?.repr;
    const match = repr?.match(/^u(\d+)$/);
    const agentId = match ? Number(match[1]) : null;

    // Persist to KV if changed
    if (agentId !== agent.erc8004AgentId) {
      agent.erc8004AgentId = agentId;
      const updated = JSON.stringify(agent);
      await Promise.all([
        kv.put(`stx:${agent.stxAddress}`, updated),
        kv.put(`btc:${agent.btcAddress}`, updated),
      ]);
    }

    const cacheHeader = agentId != null
      ? "public, max-age=300, s-maxage=600"
      : "public, max-age=60, s-maxage=120";

    return NextResponse.json(
      { agentId },
      { headers: { "Cache-Control": cacheHeader } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Identity detection failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
