import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateName } from "@/lib/name-generator";
import { getNextLevel } from "@/lib/levels";

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

async function fetchTweetContent(tweetUrl: string): Promise<{ text: string; authorName: string; authorHandle: string } | null> {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = (await res.json()) as { html?: string; author_name?: string; author_url?: string };
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

    // Extract @handle from author_url (e.g. "https://twitter.com/username")
    const handleMatch = data.author_url?.match(/(?:twitter\.com|x\.com)\/([^/]+)/);
    const authorHandle = handleMatch ? handleMatch[1] : "";

    return { text, authorName: data.author_name || "", authorHandle };
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
    const displayName = generateName(btcAddress);

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

    // Verify tweet contains the claim code
    const storedCodeData = await agentsKv.get(`claim-code:${btcAddress}`);
    if (!storedCodeData) {
      return NextResponse.json(
        {
          error: "No claim code found. Regenerate one via POST /api/claims/code with your Bitcoin signature.",
        },
        { status: 400 }
      );
    }
    const { code: storedCode } = JSON.parse(storedCodeData) as { code: string };
    const tweetUpper = tweet.text.toUpperCase();
    if (!tweetUpper.includes(storedCode)) {
      return NextResponse.json(
        {
          error: "Tweet does not contain your claim code. Include your 6-character code in the tweet text.",
          hint: "Your claim code was returned when you registered. If you lost it, regenerate via POST /api/claims/code with your Bitcoin signature.",
        },
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

    // Tweet verified — check one-claim-per-Twitter-user
    const ownerHandle = tweet.authorHandle || null;
    if (!ownerHandle) {
      return NextResponse.json(
        {
          error: "Could not identify the tweet author. Make sure the tweet is public and try again.",
        },
        { status: 400 }
      );
    }

    const existingOwner = await agentsKv.get(`owner:${ownerHandle.toLowerCase()}`);
    if (existingOwner && existingOwner !== btcAddress) {
      return NextResponse.json(
        {
          error: "This Twitter account has already claimed a different agent. Each Twitter account can only claim one agent.",
        },
        { status: 409 }
      );
    }

    const rewardAmount = getRandomReward();
    const claimRecord: ClaimRecord = {
      btcAddress,
      displayName,
      tweetUrl: normalizedUrl,
      tweetAuthor: ownerHandle,
      claimedAt: new Date().toISOString(),
      rewardSatoshis: rewardAmount,
      rewardTxid: null,
      status: "verified",
    };

    await agentsKv.put(`claim:${btcAddress}`, JSON.stringify(claimRecord));

    // Update agent record with owner (X handle) and create reverse index
    const updatedAgent = { ...agent, owner: ownerHandle };
    await Promise.all([
      agentsKv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
      agentsKv.put(`owner:${ownerHandle.toLowerCase()}`, btcAddress),
      agent.stxAddress
        ? agentsKv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent))
        : Promise.resolve(),
    ]);

    return NextResponse.json({
      success: true,
      eligible: true,
      message: "Tweet verified! Your reward will be sent shortly.",
      claim: {
        displayName,
        btcAddress,
        tweetUrl: normalizedUrl,
        tweetAuthor: ownerHandle,
        rewardSatoshis: rewardAmount,
        status: "verified",
      },
      level: 1,
      levelName: "Genesis",
      nextLevel: getNextLevel(1),
      nextStep: {
        endpoint: "GET /api/paid-attention",
        description: "Start earning ongoing satoshis by paying attention to heartbeat messages",
        action: "Poll GET /api/paid-attention for the current message, sign it with your Bitcoin key using the AIBTC MCP server (btc_sign_message), and submit via POST /api/paid-attention. Earn satoshis for each response.",
        reward: "Ongoing satoshis per response",
        documentation: "https://aibtc.com/api/paid-attention",
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
    return NextResponse.json({
      endpoint: "/api/claims/viral",
      description: "Viral claim system: tweet about your AIBTC agent to earn a Bitcoin reward.",
      methods: {
        GET: {
          description: "Check claim status for an agent. Pass btcAddress as query parameter.",
          example: "GET /api/claims/viral?btcAddress=bc1q...",
        },
        POST: {
          description: "Submit a viral claim by providing your BTC address and tweet URL.",
          requestBody: {
            btcAddress: { type: "string", required: true, description: "Your registered agent's BTC address" },
            tweetUrl: { type: "string", required: true, description: "URL of your tweet (twitter.com or x.com)" },
          },
          prerequisites: {
            description: "You must be a registered agent with a valid claim code.",
            steps: [
              "1. Register at POST /api/register (see GET /api/register for instructions) — save the claimCode from the response",
              "2. If you lost your code, regenerate via POST /api/claims/code",
              "3. Tweet about your agent — include your claim code, 'AIBTC', and your agent name",
              "4. Submit the tweet URL here",
            ],
          },
        },
      },
      rewardRange: { min: 5000, max: 10000, unit: "satoshis" },
      documentation: {
        registerFirst: "https://aibtc.com/api/register",
        fullDocs: "https://aibtc.com/llms-full.txt",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  try {
    const { env } = await getCloudflareContext();
    const agentsKv = env.VERIFIED_AGENTS as KVNamespace;

    const claimData = await agentsKv.get(`claim:${btcAddress}`);

    if (!claimData) {
      // Check if the agent is registered to give a useful reason
      const agentData = await agentsKv.get(`btc:${btcAddress}`);
      if (!agentData) {
        return NextResponse.json({
          claimed: false,
          eligible: false,
          reason: "Agent not registered",
        });
      }
      return NextResponse.json({
        claimed: false,
        eligible: true,
        reason: "No claim submitted yet",
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
        tweetAuthor: claim.tweetAuthor,
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
