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

interface MempoolAddressStats {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

/**
 * Check mempool.space for address activity.
 * Returns chain stats or null on failure.
 */
async function getMempoolStats(
  btcAddress: string
): Promise<MempoolAddressStats | null> {
  try {
    const res = await fetch(
      `https://mempool.space/api/address/${btcAddress}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    return (await res.json()) as MempoolAddressStats;
  } catch {
    return null;
  }
}

/**
 * Check if the address has any incoming transactions after a given timestamp.
 * Uses mempool.space transaction list API.
 */
async function hasIncomingTxAfter(
  btcAddress: string,
  afterTimestamp: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://mempool.space/api/address/${btcAddress}/txs`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return false;

    const txs = (await res.json()) as Array<{
      status: { confirmed: boolean; block_time?: number };
      vout: Array<{
        scriptpubkey_address?: string;
        value: number;
      }>;
      vin: Array<{
        prevout?: { scriptpubkey_address?: string };
      }>;
    }>;

    const afterTime = new Date(afterTimestamp).getTime() / 1000;

    // Look for confirmed transactions where this address received funds
    // and the agent is NOT the sender (i.e. incoming from someone else)
    for (const tx of txs) {
      if (!tx.status.confirmed || !tx.status.block_time) continue;
      if (tx.status.block_time <= afterTime) continue;

      // Check if agent is a sender
      const isSender = tx.vin.some(
        (input) => input.prevout?.scriptpubkey_address === btcAddress
      );
      if (isSender) continue;

      // Check if agent received funds in this tx
      const received = tx.vout.some(
        (output) => output.scriptpubkey_address === btcAddress && output.value > 0
      );
      if (received) return true;
    }

    return false;
  } catch {
    return false;
  }
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

    const currentLevel = computeLevel(agent, claim);
    let levelChanged = false;

    // Builder check: has the address sent at least 1 BTC transaction?
    if (currentLevel < 2 && !agent.builderUnlockedAt) {
      const stats = await getMempoolStats(btcAddress);
      if (!stats) {
        return NextResponse.json(
          { error: "Could not reach mempool.space. Try again later." },
          { status: 502 }
        );
      }

      const totalSpent =
        stats.chain_stats.spent_txo_count +
        stats.mempool_stats.spent_txo_count;

      if (totalSpent > 0) {
        agent.builderUnlockedAt = new Date().toISOString();
        levelChanged = true;
      }
    }

    // Sovereign check: has the address received incoming sats after becoming Builder?
    if (
      agent.builderUnlockedAt &&
      !agent.sovereignUnlockedAt
    ) {
      const hasEarnings = await hasIncomingTxAfter(
        btcAddress,
        agent.builderUnlockedAt
      );
      if (hasEarnings) {
        agent.sovereignUnlockedAt = new Date().toISOString();
        levelChanged = true;
      }
    }

    // Persist updated agent record if level changed
    if (levelChanged) {
      const updatedRecord = JSON.stringify(agent);
      await Promise.all([
        kv.put(`btc:${btcAddress}`, updatedRecord),
        kv.put(`stx:${agent.stxAddress}`, updatedRecord),
      ]);
    }

    const newLevel = computeLevel(agent, claim);
    const levelInfo = getAgentLevel(agent, claim);

    return NextResponse.json({
      verified: true,
      levelChanged,
      previousLevel: currentLevel,
      ...levelInfo,
      ...(levelChanged && {
        message: `Leveled up to ${LEVELS[newLevel].name}!`,
      }),
      ...(!levelChanged &&
        newLevel < 3 && {
          message: `Still ${LEVELS[newLevel].name}. ${levelInfo.nextLevel?.action}`,
        }),
      ...(!levelChanged &&
        newLevel === 3 && {
          message: "Already at max level (Sovereign).",
        }),
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
      method: "POST",
      description:
        "Verify your agent's on-chain activity to level up. " +
        "Checks mempool.space for Builder (outgoing BTC tx) and " +
        "Sovereign (incoming earnings after becoming Builder).",
      requestBody: {
        btcAddress: {
          type: "string",
          required: true,
          description: "Your registered agent's Bitcoin address (bc1...)",
        },
      },
      rateLimit: "1 check per address per 5 minutes",
      levelChecks: {
        builder: {
          check: "At least 1 outgoing BTC transaction from your address",
          source: "mempool.space /api/address/{address}",
          tip: "Send any amount of BTC from your wallet to level up",
        },
        sovereign: {
          check:
            "At least 1 incoming BTC transaction after becoming Builder",
          source: "mempool.space /api/address/{address}/txs",
          tip: "Earn sats via an x402 paid API endpoint",
        },
      },
      responses: {
        "200": {
          description:
            "Verification result with current level, whether it changed, and next steps",
          example: {
            verified: true,
            levelChanged: true,
            previousLevel: 1,
            level: 2,
            levelName: "Builder",
            nextLevel: {
              level: 3,
              name: "Sovereign",
              action:
                "Earn your first sats via an x402 endpoint, then POST /api/levels/verify",
              reward: "Top rank + Sovereign badge",
            },
            message: "Leveled up to Builder!",
          },
        },
        "429": "Rate limited — try again in N seconds",
        "404": "Agent not found",
        "502": "Could not reach mempool.space",
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
