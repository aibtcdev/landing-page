import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { generateName } from "@/lib/name-generator";
import { getVouchIndex, MAX_REFERRALS } from "@/lib/vouch";

/** Lightweight address format check — must look like a BTC or STX address. */
function isValidAddressFormat(address: string): boolean {
  if (address.length < 10 || address.length > 100) return false;
  return address.startsWith("bc1") || address.startsWith("SP") || address.startsWith("SM");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const normalizedAddress = address?.trim() ?? "";

  // Validate address format before KV access
  if (!normalizedAddress || !isValidAddressFormat(normalizedAddress)) {
    return NextResponse.json(
      {
        error: "Invalid address format. Must be a Bitcoin (bc1...) or Stacks (SP...) address.",
        hint: "Example: /api/vouch/bc1q...",
      },
      { status: 400 }
    );
  }

  // Parse pagination params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 50) : 20;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const agent = await lookupAgent(kv, normalizedAddress);
    if (!agent) {
      return NextResponse.json(
        {
          error: "Agent not found. Register first.",
          nextStep: { endpoint: "POST /api/register" },
        },
        { status: 404 }
      );
    }

    // Get who vouched for this agent
    let vouchedByInfo: { btcAddress: string; displayName: string } | null =
      null;
    if (agent.referredBy) {
      const referrer = await lookupAgent(kv, agent.referredBy);
      if (referrer) {
        vouchedByInfo = {
          btcAddress: referrer.btcAddress,
          displayName:
            referrer.displayName || generateName(referrer.btcAddress),
        };
      }
    }

    // Get paginated list of agents this agent has vouched for
    const index = await getVouchIndex(kv, agent.btcAddress);
    const allReferees = index?.refereeAddresses ?? [];
    const totalCount = allReferees.length;
    const paginatedReferees = allReferees.slice(offset, offset + limit);

    const vouchedForAgents = await Promise.all(
      paginatedReferees.map(async (refereeBtc) => {
        const referee = await lookupAgent(kv, refereeBtc);
        return {
          btcAddress: refereeBtc,
          displayName:
            referee?.displayName || generateName(refereeBtc),
          registeredAt: referee?.verifiedAt || null,
        };
      })
    );

    return NextResponse.json(
      {
        agent: {
          btcAddress: agent.btcAddress,
          displayName:
            agent.displayName || generateName(agent.btcAddress),
        },
        vouchedBy: vouchedByInfo,
        vouchedFor: {
          count: totalCount,
          maxReferrals: MAX_REFERRALS,
          remainingReferrals: Math.max(0, MAX_REFERRALS - totalCount),
          agents: vouchedForAgents,
          pagination: {
            limit,
            offset,
            hasMore: offset + limit < totalCount,
            nextOffset: offset + limit < totalCount ? offset + limit : null,
          },
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch vouch data: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

