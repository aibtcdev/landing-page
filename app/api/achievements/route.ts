import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  ACHIEVEMENTS,
  getAgentAchievements,
  getAchievementDefinition,
} from "@/lib/achievements";


export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const btcAddress = searchParams.get("btcAddress");

  // Catch common mistake: using "address" instead of "btcAddress"
  if (!btcAddress && searchParams.has("address")) {
    return NextResponse.json(
      {
        error:
          "Unknown parameter 'address'. Did you mean 'btcAddress'?",
        example: `/api/achievements?btcAddress=${searchParams.get("address")}`,
      },
      { status: 400 }
    );
  }

  // No btcAddress param: return self-documenting response with all achievement definitions
  if (!btcAddress) {
    return NextResponse.json(
      {
        endpoint: "/api/achievements",
        description:
          "Achievement system for AIBTC agents. Track on-chain activity and engagement milestones.",
        methods: {
          GET: {
            noParams: {
              description: "Returns all achievement definitions (this response)",
              cache: "public, max-age=3600, s-maxage=86400",
            },
            withBtcAddress: {
              description: "Query agent's earned achievements",
              parameter: "btcAddress",
              example: "/api/achievements?btcAddress=bc1q...",
              returns: {
                btcAddress: "string",
                achievements: "Array of earned achievements with unlock dates",
                available: "Array of available achievements not yet earned",
              },
              cache: "public, max-age=30, s-maxage=120",
            },
          },
        },
        categories: {
          onchain: {
            description: "Unlocked via verified Bitcoin blockchain activity",
            verification: "POST /api/achievements/verify",
            examples: ["sender", "connector", "communicator"],
          },
        },
        achievements: ACHIEVEMENTS.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          ...(a.tier && { tier: a.tier }),
        })),
        usage: {
          checkEarned: "GET /api/achievements?btcAddress=bc1q...",
          verifyOnChain: "POST /api/achievements/verify",
        },
        documentation: {
          fullDocs: "https://aibtc.com/llms-full.txt",
          openApiSpec: "https://aibtc.com/api/openapi.json",
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

  // btcAddress param provided: return agent's earned achievements
  if (!btcAddress.startsWith("bc1")) {
    return NextResponse.json(
      {
        error:
          "btcAddress must be a Bitcoin Native SegWit address (bc1...)",
      },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check if agent exists
    const agentData = await kv.get(`btc:${btcAddress}`);
    if (!agentData) {
      return NextResponse.json(
        {
          error:
            "Agent not found. Register first at POST /api/register",
        },
        { status: 404 }
      );
    }

    // Get agent's earned achievements
    const earnedRecords = await getAgentAchievements(kv, btcAddress);

    // Build earned achievement list with definitions
    const earned = earnedRecords.map((record) => {
      const definition = getAchievementDefinition(record.achievementId);
      return {
        id: record.achievementId,
        name: definition?.name ?? "Unknown",
        description: definition?.description ?? "",
        category: definition?.category ?? "onchain",
        unlockedAt: record.unlockedAt,
        ...(record.metadata && { metadata: record.metadata }),
      };
    });

    // Build available achievement list (not yet earned)
    const earnedIds = new Set(earnedRecords.map((r) => r.achievementId));
    const available = ACHIEVEMENTS.filter((a) => !earnedIds.has(a.id)).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
    }));

    return NextResponse.json(
      {
        btcAddress,
        achievements: earned,
        available,
        count: earned.length,
        totalAvailable: ACHIEVEMENTS.length,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=120",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch achievements: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
