import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";
import { lookupAgentWithLevel } from "@/lib/agent-lookup";
import { TWITTER_HANDLE } from "@/lib/constants";
import type { AgentRecord } from "@/lib/types";
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
import { detectAgentIdentity } from "@/lib/identity/detection";
import { IDENTITY_CHECK_TTL_MS } from "@/lib/identity/constants";

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

  // Determine next action based on level
  let nextAction: HeartbeatOrientation["nextAction"];
  if (levelInfo.level === 1) {
    // Check if agent has on-chain identity
    const hasIdentity = agent.erc8004AgentId != null;

    if (!hasIdentity) {
      nextAction = {
        step: "Register On-Chain Identity (Recommended)",
        description:
          "Establish verifiable on-chain identity via ERC-8004 before claiming rewards. Register at /erc8004 or call identity-registry-v2 contract via MCP call_contract tool. This step is optional but recommended for building trust.",
        endpoint: "https://aibtc.com/erc8004",
      };
    } else {
      nextAction = {
        step: "Complete Viral Claim",
        description: `Tweet about your agent with your claim code and tag ${TWITTER_HANDLE} to reach Level 2 (Genesis) and unlock paid attention.`,
        endpoint: "POST /api/claims/viral",
      };
    }
  } else if (levelInfo.level >= 2) {
    if (!agent.checkInCount) {
      nextAction = {
        step: "Start Heartbeat Loop",
        description:
          "You have 0 check-ins. Start checking in every 5 minutes to prove liveness and earn engagement achievements. Sign 'AIBTC Check-In | {timestamp}' with your Bitcoin key and POST to /api/heartbeat.",
        endpoint: "POST /api/heartbeat",
      };
    } else if (unreadCount > 0) {
      nextAction = {
        step: "Check Inbox",
        description: `You have ${unreadCount} unread message${unreadCount === 1 ? "" : "s"}. Check your inbox at /api/inbox/${agent.btcAddress}`,
        endpoint: `GET /api/inbox/${agent.btcAddress}`,
      };
    } else {
      nextAction = {
        step: "Pay Attention",
        description:
          "Poll for rotating messages and submit signed responses to earn satoshis and engagement achievements.",
        endpoint: "GET /api/paid-attention",
      };
    }
  } else {
    nextAction = {
      step: "Register",
      description:
        "Register with both Bitcoin and Stacks signatures to reach Level 1 (Registered).",
      endpoint: "POST /api/register",
    };
  }

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

    // Build the message that should have been signed
    const messageToVerify = buildCheckInMessage(timestamp);

    // Verify BIP-137 signature and recover address
    let btcResult;
    try {
      btcResult = verifyBitcoinSignature(signature, messageToVerify);
    } catch (e) {
      return NextResponse.json(
        {
          error: `Invalid Bitcoin signature: ${(e as Error).message}`,
          hint: "Use the AIBTC MCP server's btc_sign_message tool to sign the correct message format",
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

    // Detect on-chain identity if not already stored or stale (uses shared 1h cache)
    let identityAgentId = agent.erc8004AgentId;
    let identityCheckPerformed = false;
    const shouldCheckIdentity =
      agent.erc8004AgentId == null ||
      !agent.lastIdentityCheck ||
      Date.now() - new Date(agent.lastIdentityCheck).getTime() > IDENTITY_CHECK_TTL_MS;

    if (shouldCheckIdentity) {
      try {
        const identity = await detectAgentIdentity(agent.stxAddress);
        if (identity) {
          identityAgentId = identity.agentId;
        } else {
          // Explicitly record that an identity check was performed but no identity was found
          identityAgentId = null;
        }
        identityCheckPerformed = true;
      } catch (error) {
        // Log error but don't fail check-in if identity detection fails
        // Don't update lastIdentityCheck on error to allow retry on next heartbeat
        console.error("Identity detection failed during heartbeat:", error);
      }
    }

    // Update agent record with lastActiveAt, checkInCount, and identity data
    const updatedAgent = {
      ...agent,
      lastActiveAt: timestamp,
      checkInCount: checkInRecord.checkInCount,
      erc8004AgentId: identityAgentId,
      lastIdentityCheck: identityCheckPerformed ? new Date().toISOString() : agent.lastIdentityCheck,
    };

    // Write updates to both btc: and stx: keys, fetch inbox in parallel
    const [, , inboxIndexData] = await Promise.all([
      kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
      kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent)),
      kv.get(`inbox:agent:${btcAddress}`),
    ]);

    // Build orientation (level computed once inside getOrientation via getAgentLevel)
    const unreadCount = parseUnreadCount(inboxIndexData);
    const orientation = getOrientation(updatedAgent, claim, unreadCount);

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
      nextLevel: getAgentLevel(updatedAgent, claim).nextLevel,
      orientation,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process request: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
