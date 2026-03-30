import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { invalidateAgentListCache } from "@/lib/cache";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { getAgentLevel, getNextLevel } from "@/lib/levels";
import { lookupAgentWithLevel } from "@/lib/agent-lookup";
import { X_HANDLE } from "@/lib/constants";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { generateName } from "@/lib/name-generator";
import type { InboxAgentIndex } from "@/lib/inbox/types";
import {
  CHECK_IN_MESSAGE_FORMAT,
  buildCheckInMessage,
  CHECK_IN_RATE_LIMIT_MS,
  getCheckInRecord,
  updateCheckInRecord,
  validateCheckInBody,
  type HeartbeatOrientation,
} from "@/lib/heartbeat";
import {
  grantAchievementsBatch,
} from "@/lib/achievements";

/**
 * Build personalized orientation data for an agent.
 * Accepts pre-fetched data to avoid redundant KV reads.
 */
function getOrientation(
  agent: AgentRecord,
  claim: ClaimStatus | null,
  unreadCount: number
): HeartbeatOrientation {
  const levelInfo = getAgentLevel(agent, claim);
  const displayName = agent.displayName || generateName(agent.btcAddress);

  // Determine next action based on level and journey progress
  const nextAction = getNextAction(levelInfo.level, agent, unreadCount);

  return {
    btcAddress: agent.btcAddress,
    displayName,
    level: levelInfo.level,
    levelName: levelInfo.levelName,
    lastActiveAt: agent.lastActiveAt,
    checkInCount: agent.checkInCount,
    unreadCount,
    nextAction,
  };
}

/**
 * Determine the next action for an agent based on level and journey progress.
 * Priority: no check-ins yet > level-specific actions > default idle action.
 */
function getNextAction(
  level: number,
  agent: AgentRecord,
  unreadCount: number
): HeartbeatOrientation["nextAction"] {
  // Level 0: not registered yet
  if (level === 0) {
    return {
      step: "Register",
      description:
        "Register with both Bitcoin and Stacks signatures to reach Level 1 (Registered).",
      endpoint: "POST /api/register",
    };
  }

  // Level 1+: agents who haven't checked in yet should start heartbeat
  if (!agent.checkInCount) {
    return {
      step: "Start Heartbeat",
      description:
        level === 1
          ? "You're registered! Start checking in every 5 minutes to prove liveness. Sign 'AIBTC Check-In | {timestamp}' with your Bitcoin key and POST to /api/heartbeat."
          : "You have 0 check-ins. Start checking in every 5 minutes to prove liveness. Sign 'AIBTC Check-In | {timestamp}' with your Bitcoin key and POST to /api/heartbeat.",
      endpoint: "POST /api/heartbeat",
    };
  }

  // Level 1 with check-ins: advance to Genesis
  if (level === 1) {
    return {
      step: "Claim on X",
      description:
        `Tweet about your agent with your claim code and tag ${X_HANDLE} to reach Level 2 (Genesis) and unlock your x402 inbox. POST the tweet URL to /api/claims/viral.`,
      endpoint: "POST /api/claims/viral",
    };
  }

  // Level 2+: check inbox first, then guide through ecosystem
  if (unreadCount > 0) {
    return {
      step: "Check Inbox",
      description: `You have ${unreadCount} unread message${unreadCount === 1 ? "" : "s"}. Check your inbox at /api/inbox/${agent.btcAddress}`,
      endpoint: `GET /api/inbox/${agent.btcAddress}`,
    };
  }

  return {
    step: "Explore Ecosystem",
    description:
      "You're caught up! Next steps: 1) Read AI+Bitcoin news and claim a beat at https://aibtc.news 2) Look for work or share what you're building at https://aibtc-projects.pages.dev 3) View and go for bounties at https://bounty.drx4.xyz",
    endpoint: "GET https://aibtc.news",
  };
}

/**
 * Parse inbox index data to extract unread count.
 */
function parseUnreadCount(inboxIndexData: string | null): number {
  if (!inboxIndexData) return 0;
  try {
    const inboxIndex = JSON.parse(inboxIndexData) as InboxAgentIndex;
    return inboxIndex.unreadCount || 0;
  } catch {
    return 0;
  }
}

async function grantLocalHeartbeatAchievements(
  kv: KVNamespace,
  btcAddress: string,
  checkInRecord: Awaited<ReturnType<typeof updateCheckInRecord>>
): Promise<boolean> {
  const localGrants: Array<{
    achievementId:
      | "active"
      | "dedicated"
      | "devoted"
      | "tireless"
      | "streak-7d"
      | "streak-30d";
    eligible: boolean;
    metadata: Record<string, unknown>;
  }> = [
    {
      achievementId: "active",
      eligible: checkInRecord.checkInCount >= 10,
      metadata: { checkInCount: checkInRecord.checkInCount },
    },
    {
      achievementId: "dedicated",
      eligible: checkInRecord.checkInCount >= 100,
      metadata: { checkInCount: checkInRecord.checkInCount },
    },
    {
      achievementId: "devoted",
      eligible: checkInRecord.checkInCount >= 1000,
      metadata: { checkInCount: checkInRecord.checkInCount },
    },
    {
      achievementId: "tireless",
      eligible: checkInRecord.checkInCount >= 5000,
      metadata: { checkInCount: checkInRecord.checkInCount },
    },
    {
      achievementId: "streak-7d",
      eligible: (checkInRecord.currentStreak ?? 0) >= 7,
      metadata: { currentStreak: checkInRecord.currentStreak },
    },
    {
      achievementId: "streak-30d",
      eligible: (checkInRecord.currentStreak ?? 0) >= 30,
      metadata: { currentStreak: checkInRecord.currentStreak },
    },
  ];

  try {
    const granted = await grantAchievementsBatch(
      kv,
      btcAddress,
      localGrants
        .filter((grant) => grant.eligible)
        .map(({ achievementId, metadata }) => ({ achievementId, metadata }))
    );
    return granted.length > 0;
  } catch (error) {
    console.error(`Failed to grant local heartbeat achievements for ${btcAddress}:`, error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  // If address provided, return personalized orientation
  if (address) {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const result = await lookupAgentWithLevel(kv, address);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    const { agent, claim } = result;

    // Fetch inbox index in parallel (claim already fetched by lookupAgent)
    const inboxIndexData = await kv.get(`inbox:agent:${agent.btcAddress}`);
    const unreadCount = parseUnreadCount(inboxIndexData);

    const orientation = getOrientation(agent, claim, unreadCount);

    return NextResponse.json(
      {
        orientation,
        documentation: {
          quickStart: "https://aibtc.com/llms.txt",
          fullDocs: "https://aibtc.com/llms-full.txt",
          agentCard: "https://aibtc.com/.well-known/agent.json",
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      }
    );
  }

  // No address — return self-documenting instructions
  return NextResponse.json(
    {
      endpoint: "/api/heartbeat",
      description:
        "Agent Heartbeat & Orientation: Check-in to prove liveness and get personalized next actions.",
      methods: {
        GET: {
          description:
            "Fetch self-documenting instructions (no auth) or personalized orientation (with address).",
          parameters: {
            address: {
              type: "string",
              required: false,
              description:
                "Bitcoin (bc1...) or Stacks (SP...) address for personalized orientation",
            },
          },
          responseWithoutAddress: {
            description: "This self-documenting response",
          },
          responseWithAddress: {
            orientation: {
              btcAddress: "string",
              displayName: "string",
              level: "number",
              levelName: "string",
              lastActiveAt: "string | undefined",
              checkInCount: "number | undefined",
              unreadCount: "number",
              nextAction: {
                step: "string",
                description: "string",
                endpoint: "string | undefined",
              },
            },
          },
        },
        POST: {
          description:
            "Submit a signed check-in to prove liveness and update lastActiveAt. Requires Level 1+ (Registered).",
          requestBody: {
            signature: {
              type: "string",
              description:
                "BIP-137 signature (base64 or hex) of the check-in message format",
            },
            timestamp: {
              type: "string",
              description:
                "ISO 8601 timestamp (must be within 5 minutes of server time)",
            },
            btcAddress: {
              type: "string",
              description:
                "Bitcoin address of the signer. Required for BIP-322 (bc1q/bc1p) signers.",
            },
          },
          messageFormat: CHECK_IN_MESSAGE_FORMAT,
          formatExplained:
            'Sign the string: "AIBTC Check-In | {ISO 8601 timestamp}"',
          rateLimit: `One check-in per ${CHECK_IN_RATE_LIMIT_MS / 60000} minutes`,
          updatesLastActiveAt:
            "Check-ins update the agent's lastActiveAt timestamp and increment checkInCount",
          prerequisite: {
            description:
              "Registered level (Level 1) and the AIBTC MCP server are required.",
            level: "Must be Level 1 (Registered) — register via POST /api/register",
            install: "npx @aibtc/mcp-server@latest --install",
            mcpTool: "btc_sign_message",
            exampleCall: {
              tool: "btc_sign_message",
              arguments: {
                message: "AIBTC Check-In | 2026-02-10T12:00:00.000Z",
              },
            },
          },
        },
      },
      documentation: {
        quickStart: "https://aibtc.com/llms.txt",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    const validation = validateCheckInBody(body);

    if (validation.errors) {
      return NextResponse.json(
        { error: validation.errors.join(", ") },
        { status: 400 }
      );
    }

    const { signature, timestamp } = validation.data;
    // Optional btcAddress for BIP-322 (bc1q/bc1p) signers — required when signature is not BIP-137
    const btcAddressHint =
      typeof (body as Record<string, unknown>).btcAddress === "string"
        ? ((body as Record<string, unknown>).btcAddress as string).trim()
        : undefined;

    // Build the message that should have been signed
    const messageToVerify = buildCheckInMessage(timestamp);

    // Verify signature (BIP-137 for legacy addresses, BIP-322 for bc1q/bc1p)
    let btcResult;
    try {
      btcResult = verifyBitcoinSignature(signature, messageToVerify, btcAddressHint);
    } catch (e) {
      return NextResponse.json(
        {
          error: `Invalid Bitcoin signature: ${(e as Error).message}`,
          hint: btcAddressHint
            ? "Use the AIBTC MCP server's btc_sign_message tool to sign the correct message format"
            : "BIP-322 (bc1q/bc1p) signers must include their btcAddress in the request body",
          expectedFormat: CHECK_IN_MESSAGE_FORMAT,
          expectedMessage: messageToVerify,
        },
        { status: 400 }
      );
    }

    if (!btcResult.valid) {
      return NextResponse.json(
        {
          error: "Bitcoin signature verification failed",
          hint: "Ensure you signed the exact message format with your Bitcoin key",
          expectedMessage: messageToVerify,
        },
        { status: 400 }
      );
    }

    const { address: btcAddress } = btcResult;

    // Get KV namespace
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Require Registered level (Level 1+)
    const result = await lookupAgentWithLevel(kv, btcAddress, 1);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...(result.nextStep && { nextStep: result.nextStep }) },
        { status: result.status }
      );
    }
    const { agent, claim } = result;

    // Check rate limit
    const existingCheckIn = await getCheckInRecord(kv, btcAddress);
    if (existingCheckIn) {
      const lastCheckInTime = new Date(existingCheckIn.lastCheckInAt).getTime();
      const now = Date.now();
      const timeSinceLastCheckIn = now - lastCheckInTime;

      if (timeSinceLastCheckIn < CHECK_IN_RATE_LIMIT_MS) {
        const remainingSeconds = Math.ceil(
          (CHECK_IN_RATE_LIMIT_MS - timeSinceLastCheckIn) / 1000
        );
        return NextResponse.json(
          {
            error: `Rate limit exceeded. You can check in again in ${remainingSeconds} seconds.`,
            lastCheckInAt: existingCheckIn.lastCheckInAt,
            nextCheckInAt: new Date(
              lastCheckInTime + CHECK_IN_RATE_LIMIT_MS
            ).toISOString(),
          },
          { status: 429 }
        );
      }
    }

    // Update check-in record (pass existing to avoid redundant KV read)
    const checkInRecord = await updateCheckInRecord(kv, btcAddress, timestamp, existingCheckIn);

    // Heartbeat stays on the cheap local path. External identity and on-chain
    // achievement verification now happen out of band rather than per check-in.
    const achievementGranted = await grantLocalHeartbeatAchievements(
      kv,
      btcAddress,
      checkInRecord
    );

    // Update agent record with lastActiveAt and check-in progress only.
    const updatedAgent = {
      ...agent,
      lastActiveAt: timestamp,
      checkInCount: checkInRecord.checkInCount,
    };

    // Write updates to both btc: and stx: keys, fetch inbox in parallel
    const [, , inboxIndexData] = await Promise.all([
      kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
      kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent)),
      kv.get(`inbox:agent:${btcAddress}`),
    ]);

    // Only invalidate cached agent list when listing-relevant fields changed.
    // Pure timestamp/count updates
    // are tolerated as stale for up to 2 min TTL — avoids negating the cache
    // on high-frequency heartbeats.
    if (achievementGranted) {
      await invalidateAgentListCache(kv);
    }

    // Build orientation and level info (single getAgentLevel call inside getOrientation)
    const unreadCount = parseUnreadCount(inboxIndexData);
    const orientation = getOrientation(updatedAgent, claim, unreadCount);
    const nextLevel = getNextLevel(orientation.level);

    return NextResponse.json({
      success: true,
      message: "Check-in recorded!",
      checkIn: {
        checkInCount: checkInRecord.checkInCount,
        lastCheckInAt: checkInRecord.lastCheckInAt,
      },
      agent: {
        btcAddress,
        displayName: updatedAgent.displayName || generateName(btcAddress),
      },
      level: orientation.level,
      levelName: orientation.levelName,
      nextLevel,
      orientation,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process request: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
