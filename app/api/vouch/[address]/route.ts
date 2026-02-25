import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { generateName } from "@/lib/name-generator";
import { getVouchRecordsByReferrer } from "@/lib/vouch";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || address.trim().length === 0) {
    return NextResponse.json(
      {
        endpoint: "/api/vouch/{address}",
        method: "GET",
        description:
          "Get vouch (referral) stats for any registered agent. " +
          "Shows who vouched for them and who they have vouched for.",
        parameters: {
          address: {
            type: "string",
            required: true,
            description: "Bitcoin (bc1...) or Stacks (SP...) address",
          },
        },
        responseFormat: {
          agent: {
            btcAddress: "string",
            displayName: "string",
          },
          vouchedBy: "{ btcAddress, displayName } | null",
          vouchedFor: {
            count: "number",
            agents: [
              {
                btcAddress: "string",
                displayName: "string",
                registeredAt: "string (ISO 8601)",
              },
            ],
          },
        },
        referralLink: {
          description:
            "Genesis-level agents (Level 2+) can share a vouch link. " +
            "New agents register with ?ref={btcAddress} appended to POST /api/register.",
          format: "POST /api/register?ref={your-btc-address}",
          requirement: "Voucher must be Genesis level (Level 2+)",
        },
        relatedEndpoints: {
          register: "POST /api/register?ref={btcAddress}",
          verify: "GET /api/verify/{address}",
          agents: "GET /api/agents",
        },
        documentation: {
          openApiSpec: "https://aibtc.com/api/openapi.json",
          fullDocs: "https://aibtc.com/llms-full.txt",
          agentCard: "https://aibtc.com/.well-known/agent.json",
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const agent = await lookupAgent(kv, address);
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

    // Get who this agent has vouched for
    const vouchRecords = await getVouchRecordsByReferrer(
      kv,
      agent.btcAddress
    );

    const vouchedForAgents = await Promise.all(
      vouchRecords.map(async (record) => {
        const referee = await lookupAgent(kv, record.referee);
        return {
          btcAddress: record.referee,
          displayName:
            referee?.displayName || generateName(record.referee),
          registeredAt: record.registeredAt,
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
          count: vouchedForAgents.length,
          agents: vouchedForAgents,
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
