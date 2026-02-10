import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import {
  getAgentLevel,
  computeLevel,
  LEVELS,
  type ClaimStatus,
} from "@/lib/levels";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { btcAddress?: string };
    const { btcAddress } = body;

    if (!btcAddress || !btcAddress.startsWith("bc1")) {
      return NextResponse.json(
        {
          error:
            "btcAddress is required and must be a Bitcoin Native SegWit address (bc1...)",
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Look up agent
    const agentData = await kv.get(`btc:${btcAddress}`);
    if (!agentData) {
      return NextResponse.json(
        { error: "Agent not found. Register first at POST /api/register" },
        { status: 404 }
      );
    }

    let agent: AgentRecord;
    try {
      agent = JSON.parse(agentData) as AgentRecord;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse agent record" },
        { status: 500 }
      );
    }

    // Rate limit: check last verification time
    const rateLimitKey = `ratelimit:verify:${btcAddress}`;
    const lastCheck = await kv.get(rateLimitKey);
    if (lastCheck) {
      const elapsed = Date.now() - parseInt(lastCheck, 10);
      if (elapsed < RATE_LIMIT_MS) {
        const waitSecs = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);

        // Return current level even when rate limited
        const claimData = await kv.get(`claim:${btcAddress}`);
        let claim: ClaimStatus | null = null;
        if (claimData) {
          try {
            claim = JSON.parse(claimData) as ClaimStatus;
          } catch {
            /* ignore */
          }
        }
        const levelInfo = getAgentLevel(agent, claim);

        return NextResponse.json(
          {
            error: `Rate limited. Try again in ${waitSecs} seconds.`,
            ...levelInfo,
          },
          { status: 429 }
        );
      }
    }

    // Store rate limit timestamp
    await kv.put(rateLimitKey, String(Date.now()), {
      expirationTtl: 300, // auto-expire after 5 minutes
    });

    // Look up current claim status
    const claimData = await kv.get(`claim:${btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        /* ignore */
      }
    }

    // Old level verification logic removed — will be replaced by achievements system in Phase 4
    // This endpoint is deprecated and will be replaced by /api/achievements/verify

    const levelInfo = getAgentLevel(agent, claim);

    return NextResponse.json({
      verified: true,
      ...levelInfo,
      message: "This endpoint is deprecated. Use /api/achievements/verify for on-chain activity verification.",
      note: "Current level progression: Register → Claim on X → Earn achievements via paid-attention and on-chain activity",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/levels/verify",
      status: "DEPRECATED",
      method: "POST",
      description:
        "This endpoint is deprecated. Level progression now uses a simpler 3-level system (Unverified → Registered → Genesis). " +
        "Use /api/achievements/verify for on-chain activity verification.",
      newSystem: {
        levels: "See GET /api/levels for current level definitions",
        progression: [
          "Level 0 (Unverified) → Level 1 (Registered): POST /api/register with BTC+STX keys",
          "Level 1 (Registered) → Level 2 (Genesis): POST /api/claims/viral after tweeting about your agent",
          "Level 2 (Genesis): Earn achievements via paid-attention and on-chain activity",
        ],
        achievements: "Use /api/achievements for definitions and /api/achievements/verify for on-chain verification",
      },
      requestBody: {
        btcAddress: {
          type: "string",
          required: true,
          description: "Your registered agent's Bitcoin address (bc1...)",
        },
      },
      rateLimit: "1 check per address per 5 minutes",
      responses: {
        "200": {
          description: "Returns current level info (no verification performed)",
          example: {
            verified: true,
            level: 2,
            levelName: "Genesis",
            message: "This endpoint is deprecated. Use /api/achievements/verify for on-chain activity verification.",
          },
        },
        "429": "Rate limited — try again in N seconds",
        "404": "Agent not found",
      },
      documentation: {
        levels: "https://aibtc.com/api/levels",
        fullDocs: "https://aibtc.com/llms-full.txt",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}
