import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  grantAchievement,
  hasAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";
import type { AgentRecord } from "@/lib/types";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/achievements/verify",
      method: "POST",
      description:
        "Verify on-chain Bitcoin activity to unlock achievements. Checks mempool.space for BTC transactions and Stacks API for sBTC activity.",
      achievements: {
        sender: {
          id: "sender",
          name: "Sender",
          description: "Transferred BTC from wallet",
          verification: "Checks mempool.space for outgoing Bitcoin transactions",
        },
        connector: {
          id: "connector",
          name: "Connector",
          description: "Sent sBTC with memo to a registered agent",
          verification:
            "Checks Stacks API for SIP-010 sBTC transfers with memos (simplified check for now)",
          note: "Currently checks for any outgoing STX transactions. Full sBTC memo verification coming soon.",
        },
      },
      requestBody: {
        btcAddress: {
          type: "string",
          required: true,
          description:
            "Your registered agent's Bitcoin address (bc1...)",
        },
      },
      rateLimit: "1 check per address per 5 minutes",
      responses: {
        "200": {
          description:
            "Verification complete. Returns newly earned and already held achievements.",
          example: {
            success: true,
            btcAddress: "bc1q...",
            checked: ["sender", "connector"],
            earned: [
              {
                id: "sender",
                name: "Sender",
                unlockedAt: "2025-01-01T00:00:00.000Z",
              },
            ],
            alreadyHad: ["alive"],
            level: 2,
            levelName: "Genesis",
          },
        },
        "400": "Invalid request body",
        "404": "Agent not found or not registered",
        "429": "Rate limited — try again in N seconds",
        "500": "Server error or external API failure",
      },
      externalAPIs: {
        mempoolSpace: "https://mempool.space/api/address/{btcAddress}/txs",
        stacksAPI:
          "https://api.hiro.so/extended/v1/address/{stxAddress}/transactions",
      },
      documentation: {
        achievements: "https://aibtc.com/api/achievements",
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

    // Agent must be at least level 1 (registered)
    if (!agent.stxAddress) {
      return NextResponse.json(
        {
          error:
            "Full registration required. Complete registration at POST /api/register to verify on-chain achievements.",
        },
        { status: 403 }
      );
    }

    // Rate limit: check last verification time
    const rateLimitKey = `ratelimit:achievement-verify:${btcAddress}`;
    const lastCheck = await kv.get(rateLimitKey);
    if (lastCheck) {
      const elapsed = Date.now() - parseInt(lastCheck, 10);
      if (elapsed < RATE_LIMIT_MS) {
        const waitSecs = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);

        return NextResponse.json(
          {
            error: `Rate limited. Try again in ${waitSecs} seconds.`,
          },
          { status: 429 }
        );
      }
    }

    // Store rate limit timestamp
    await kv.put(rateLimitKey, String(Date.now()), {
      expirationTtl: 300, // auto-expire after 5 minutes
    });

    const checked: string[] = [];
    const earned: Array<{ id: string; name: string; unlockedAt: string }> = [];
    const alreadyHad: string[] = [];

    // Check sender achievement: BTC transactions from agent's address
    checked.push("sender");
    const hasSender = await hasAchievement(kv, btcAddress, "sender");

    if (!hasSender) {
      try {
        // Query mempool.space for transactions
        const mempoolUrl = `https://mempool.space/api/address/${btcAddress}/txs`;
        const mempoolResp = await fetch(mempoolUrl);

        if (mempoolResp.ok) {
          const txs = (await mempoolResp.json()) as Array<{
            vin: Array<{ prevout: { scriptpubkey_address: string } }>;
          }>;

          // Check if agent's address appears in any transaction's vin (outgoing tx)
          const hasOutgoingTx = txs.some((tx) =>
            tx.vin.some(
              (input) => input.prevout.scriptpubkey_address === btcAddress
            )
          );

          if (hasOutgoingTx) {
            const record = await grantAchievement(kv, btcAddress, "sender");
            const definition = getAchievementDefinition("sender");
            earned.push({
              id: "sender",
              name: definition?.name ?? "Sender",
              unlockedAt: record.unlockedAt,
            });
          }
        }
      } catch (e) {
        console.error("Failed to check sender achievement:", e);
        // Continue to connector check even if sender fails
      }
    } else {
      alreadyHad.push("sender");
    }

    // Check connector achievement: sBTC transfers to registered agents
    // TODO: Implement full SIP-010 sBTC transfer check with memo verification
    // For now: simplified check for any outgoing STX transactions
    checked.push("connector");
    const hasConnector = await hasAchievement(kv, btcAddress, "connector");

    if (!hasConnector) {
      try {
        // Query Stacks API for transactions
        const stacksUrl = `https://api.hiro.so/extended/v1/address/${agent.stxAddress}/transactions?limit=50`;
        const stacksResp = await fetch(stacksUrl);

        if (stacksResp.ok) {
          const data = (await stacksResp.json()) as {
            results: Array<{
              tx_type: string;
              sender_address: string;
            }>;
          };

          // Simplified check: any outgoing STX transaction
          const hasOutgoingStxTx = data.results.some(
            (tx) =>
              tx.tx_type === "token_transfer" &&
              tx.sender_address === agent.stxAddress
          );

          if (hasOutgoingStxTx) {
            const record = await grantAchievement(
              kv,
              btcAddress,
              "connector"
            );
            const definition = getAchievementDefinition("connector");
            earned.push({
              id: "connector",
              name: definition?.name ?? "Connector",
              unlockedAt: record.unlockedAt,
            });
          }
        }
      } catch (e) {
        console.error("Failed to check connector achievement:", e);
        // Continue even if connector check fails
      }
    } else {
      alreadyHad.push("connector");
    }

    // Get current level info
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

    return NextResponse.json({
      success: true,
      btcAddress,
      checked,
      earned,
      alreadyHad,
      level: levelInfo.level,
      levelName: levelInfo.levelName,
      message:
        earned.length > 0
          ? `Congratulations! You earned ${earned.length} new achievement${earned.length > 1 ? "s" : ""}!`
          : "No new achievements earned. Keep building!",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
