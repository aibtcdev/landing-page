import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { getAgentLevel } from "@/lib/levels";
import { lookupBnsName } from "@/lib/bns";

/**
 * Determine the address type from the format.
 *
 * - Stacks mainnet addresses start with "SP"
 * - Bitcoin Native SegWit addresses start with "bc1"
 * - Returns null for unrecognized formats
 */
function getAddressType(address: string): "stx" | "btc" | null {
  if (address.startsWith("SP")) return "stx";
  if (address.startsWith("bc1")) return "btc";
  return null;
}

/**
 * GET /api/verify/:address — Agent verification endpoint.
 *
 * Given a BTC or STX address, checks whether that agent is registered
 * in the AIBTC directory.
 *
 * - If registered: returns the full agent record (200)
 * - If address format is invalid: returns 400
 * - If not found: returns 404
 * - If KV error: returns 500
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address || address.trim().length === 0) {
      return NextResponse.json(
        { error: "Address parameter is required" },
        { status: 400 }
      );
    }

    const addressType = getAddressType(address);

    if (!addressType) {
      return NextResponse.json(
        {
          error:
            "Invalid address format. Expected a Stacks address (SP...) or " +
            "Bitcoin Native SegWit address (bc1...).",
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY;

    const key = `${addressType}:${address}`;
    const value = await kv.get(key);

    if (!value) {
      return NextResponse.json(
        {
          registered: false,
          address,
          addressType,
          error: "Agent not found. This address is not registered.",
        },
        { status: 404 }
      );
    }

    let agent: AgentRecord;
    try {
      agent = JSON.parse(value) as AgentRecord;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse agent record" },
        { status: 500 }
      );
    }

    // Run BNS lookup and claim fetch in parallel (both independent)
    const [bnsName, claimData] = await Promise.all([
      !agent.bnsName && agent.stxAddress
        ? lookupBnsName(agent.stxAddress, hiroApiKey, kv)
        : Promise.resolve(null),
      kv.get(`claim:${agent.btcAddress}`),
    ]);

    // Apply BNS update if found
    if (bnsName) {
      agent.bnsName = bnsName;
      const updated = JSON.stringify(agent);
      await Promise.all([
        kv.put(`stx:${agent.stxAddress}`, updated),
        kv.put(`btc:${agent.btcAddress}`, updated),
      ]);
    }

    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        // ignore parse errors
      }
    }

    const levelInfo = getAgentLevel(agent, claim);

    return NextResponse.json(
      {
        registered: true,
        address,
        addressType,
        agent: {
          stxAddress: agent.stxAddress,
          btcAddress: agent.btcAddress,
          displayName: agent.displayName,
          description: agent.description,
          bnsName: agent.bnsName,
          verifiedAt: agent.verifiedAt,
          owner: agent.owner,
          lastActiveAt: agent.lastActiveAt,
          checkInCount: agent.checkInCount,
        },
        ...levelInfo,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
