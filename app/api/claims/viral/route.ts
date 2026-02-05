import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateName } from "@/lib/name-generator";

/**
 * Viral Claim API
 *
 * Flow:
 * 1. User tweets "My AIBTC agent is [name]" via the profile page
 * 2. User pastes their tweet URL back on the profile page
 * 3. POST verifies the tweet exists via oEmbed and contains expected text
 * 4. If valid, marks claim as verified and queues reward
 */

interface ClaimRecord {
  btcAddress: string;
  displayName: string;
  tweetUrl: string;
  tweetAuthor: string | null;
  claimedAt: string;
  rewardSatoshis: number;
  rewardTxid: string | null;
  status: "pending" | "verified" | "rewarded" | "failed";
}

const MIN_REWARD_SATS = 5000;
const MAX_REWARD_SATS = 10000;

function getRandomReward(): number {
  return Math.floor(Math.random() * (MAX_REWARD_SATS - MIN_REWARD_SATS + 1)) + MIN_REWARD_SATS;
}

/** Normalize x.com / twitter.com URLs to a canonical form */
function normalizeTweetUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "twitter.com" && parsed.hostname !== "x.com" && parsed.hostname !== "www.twitter.com" && parsed.hostname !== "www.x.com") {
      return null;
    }
    // Expected path: /{username}/status/{id}
    const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {
    return null;
  }
}

/** Fetch tweet text via Twitter's public oEmbed endpoint (no API key needed) */
async function fetchTweetContent(tweetUrl: string): Promise<{ text: string; author: string } | null> {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = (await res.json()) as { html?: string; author_name?: string };
    if (!data.html) return null;

    // Strip HTML tags to get plain text
    const text = data.html
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return { text, author: data.author_name || "" };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      tweetUrl?: string;
    };

    const { btcAddress, tweetUrl } = body;

    if (!btcAddress) {
      return NextResponse.json(
        { error: "btcAddress is required" },
        { status: 400 }
      );
    }

    if (!tweetUrl) {
      return NextResponse.json(
        { error: "tweetUrl is required" },
        { status: 400 }
      );
    }

    // Validate and normalize tweet URL
    const normalizedUrl = normalizeTweetUrl(tweetUrl);
    if (!normalizedUrl) {
      return NextResponse.json(
        { error: "Invalid tweet URL. Must be a twitter.com or x.com status link (e.g. https://x.com/user/status/123)." },
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
            status: claim.status,
          },
        });
      }

      if (claim.status === "verified" || claim.status === "pending") {
        return NextResponse.json({
          eligible: true,
          message: "Claim already submitted. Reward will be sent shortly.",
          claim: {
            displayName: claim.displayName,
            rewardSatoshis: claim.rewardSatoshis,
            status: claim.status,
            tweetUrl: claim.tweetUrl,
          },
        });
      }
    }

    // Fetch and verify tweet content via oEmbed
    const tweet = await fetchTweetContent(normalizedUrl);
    if (!tweet) {
      return NextResponse.json(
        { error: "Could not fetch tweet. Make sure the tweet is public and the URL is correct." },
        { status: 400 }
      );
    }

    // Verify tweet mentions AIBTC and the agent name or address
    const tweetLower = tweet.text.toLowerCase();
    const hasAibtc = tweetLower.includes("aibtc");
    const hasAgent = tweetLower.includes(displayName.toLowerCase()) || tweetLower.includes(btcAddress.toLowerCase());

    if (!hasAibtc || !hasAgent) {
      return NextResponse.json(
        {
          error: "Tweet does not match expected content. Make sure your tweet includes your agent name and mentions AIBTC.",
          expected: { displayName, btcAddress: btcAddress.slice(0, 12) + "..." },
          found: tweet.text.slice(0, 200),
        },
        { status: 400 }
      );
    }

    // Tweet verified — create claim
    const rewardAmount = getRandomReward();
    const claimRecord: ClaimRecord = {
      btcAddress,
      displayName,
      tweetUrl: normalizedUrl,
      tweetAuthor: tweet.author,
      claimedAt: new Date().toISOString(),
      rewardSatoshis: rewardAmount,
      rewardTxid: null,
      status: "verified",
    };

    await agentsKv.put(`claim:${btcAddress}`, JSON.stringify(claimRecord));

    return NextResponse.json({
      success: true,
      eligible: true,
      message: "Tweet verified! Your reward will be sent shortly.",
      claim: {
        displayName,
        btcAddress,
        tweetUrl: normalizedUrl,
        tweetAuthor: tweet.author,
        rewardSatoshis: rewardAmount,
        status: "verified",
      },
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
        tweetUrl: claim.tweetUrl,
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
