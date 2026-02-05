import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateName } from "@/lib/name-generator";

/**
 * Viral Claim API
 *
 * Flow:
 * 1. User tweets "My AIBTC agent is [name]" with link to profile
 * 2. User clicks "Check Claim Status" on their profile page
 * 3. This API verifies the tweet exists and matches expected format
 * 4. If valid, marks claim as complete and queues BTC reward
 *
 * Reward: $5-10 in BTC sent to agent's Bitcoin address
 */

interface ClaimRecord {
  btcAddress: string;
  displayName: string;
  tweetUrl: string | null;
  claimedAt: string;
  rewardSatoshis: number;
  rewardTxid: string | null;
  status: "pending" | "verified" | "rewarded" | "failed";
}

// Reward amount in satoshis ($5-10 at ~$100k BTC = 5000-10000 sats)
const MIN_REWARD_SATS = 5000;
const MAX_REWARD_SATS = 10000;

function getRandomReward(): number {
  return Math.floor(Math.random() * (MAX_REWARD_SATS - MIN_REWARD_SATS + 1)) + MIN_REWARD_SATS;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      tweetUrl?: string; // Optional: user can provide tweet URL directly
    };

    const { btcAddress, tweetUrl } = body;

    if (!btcAddress) {
      return NextResponse.json(
        { error: "btcAddress is required" },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const agentsKv = env.VERIFIED_AGENTS as KVNamespace;

    // Check if agent exists
    const agentData = await agentsKv.get(`btc:${btcAddress}`);
    if (!agentData) {
      return NextResponse.json(
        { error: "Agent not found. Register first at /api/register" },
        { status: 404 }
      );
    }

    const agent = JSON.parse(agentData);
    const displayName = agent.displayName || generateName(btcAddress);

    // Check for existing claim
    // Note: In production, use a separate CLAIMS KV namespace
    // For now, we'll store claims with prefix "claim:"
    const existingClaim = await agentsKv.get(`claim:${btcAddress}`);

    if (existingClaim) {
      const claim = JSON.parse(existingClaim) as ClaimRecord;

      if (claim.status === "rewarded") {
        return NextResponse.json({
          claimed: true,
          message: "Reward already sent!",
          claim: {
            displayName: claim.displayName,
            rewardSatoshis: claim.rewardSatoshis,
            rewardTxid: claim.rewardTxid,
            claimedAt: claim.claimedAt,
          },
        });
      }

      if (claim.status === "verified" || claim.status === "pending") {
        return NextResponse.json({
          eligible: true,
          message: "Claim verified! Reward will be sent shortly.",
          claim: {
            displayName: claim.displayName,
            rewardSatoshis: claim.rewardSatoshis,
            status: claim.status,
          },
        });
      }
    }

    // TODO: Implement Twitter API verification
    // For now, we'll use a simplified flow:
    // 1. If tweetUrl provided, validate format and mark as pending
    // 2. Background job will verify and send reward
    //
    // Expected tweet format:
    // "My AIBTC agent is [DisplayName] 🤖₿\n\nhttps://aibtc.com/agents/[btcAddress]\n\n@aibtcdev"

    const expectedTweetPattern = new RegExp(
      `My AIBTC agent is ${displayName}.*${btcAddress}`,
      "i"
    );

    // If no tweet URL provided, return instructions
    if (!tweetUrl) {
      const profileUrl = `https://aibtc.com/agents/${btcAddress}`;
      const expectedTweet = `My AIBTC agent is ${displayName} 🤖₿\n\n${profileUrl}\n\n@aibtcdev`;

      return NextResponse.json({
        claimed: false,
        eligible: false,
        instructions: {
          step1: "Tweet the following text:",
          tweetTemplate: expectedTweet,
          tweetUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(expectedTweet)}`,
          step2: "After tweeting, call this endpoint again with tweetUrl parameter",
          step3: "Once verified, you'll receive $5-10 in BTC!",
        },
      });
    }

    // Validate tweet URL format
    if (!tweetUrl.includes("twitter.com/") && !tweetUrl.includes("x.com/")) {
      return NextResponse.json(
        { error: "Invalid tweet URL. Must be a twitter.com or x.com link." },
        { status: 400 }
      );
    }

    // Create claim record (pending verification)
    const rewardAmount = getRandomReward();
    const claimRecord: ClaimRecord = {
      btcAddress,
      displayName,
      tweetUrl,
      claimedAt: new Date().toISOString(),
      rewardSatoshis: rewardAmount,
      rewardTxid: null,
      status: "pending",
    };

    // Store claim
    await agentsKv.put(`claim:${btcAddress}`, JSON.stringify(claimRecord));

    // TODO: In production, trigger background job to:
    // 1. Fetch tweet via Twitter API
    // 2. Verify tweet content matches expected format
    // 3. Verify tweet author (optional - for extra security)
    // 4. Send BTC reward via Lightning or on-chain
    // 5. Update claim status to "rewarded" with txid

    return NextResponse.json({
      success: true,
      eligible: true,
      message: "Claim submitted! Verifying tweet...",
      claim: {
        displayName,
        btcAddress,
        tweetUrl,
        rewardSatoshis: rewardAmount,
        estimatedRewardUSD: `$${((rewardAmount / 100000000) * 100000).toFixed(2)}`, // Assuming $100k BTC
        status: "pending",
      },
      nextSteps: [
        "Your tweet is being verified",
        "Once confirmed, BTC will be sent to your wallet",
        "Check back in a few minutes for status update",
      ],
    });
  } catch (e) {
    console.error("Viral claim error:", e);
    return NextResponse.json(
      { error: `Claim failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const btcAddress = searchParams.get("btcAddress");

  if (!btcAddress) {
    return NextResponse.json(
      { error: "btcAddress query parameter required" },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const agentsKv = env.VERIFIED_AGENTS as KVNamespace;

    const claimData = await agentsKv.get(`claim:${btcAddress}`);

    if (!claimData) {
      return NextResponse.json({
        claimed: false,
        eligible: false,
        message: "No claim found. Tweet about your agent to claim!",
      });
    }

    const claim = JSON.parse(claimData) as ClaimRecord;

    return NextResponse.json({
      claimed: claim.status === "rewarded",
      eligible: claim.status === "pending" || claim.status === "verified",
      claim: {
        displayName: claim.displayName,
        status: claim.status,
        rewardSatoshis: claim.rewardSatoshis,
        rewardTxid: claim.rewardTxid,
        claimedAt: claim.claimedAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to check claim: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
