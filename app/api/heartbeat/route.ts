import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { getAgentLevel, computeLevel, type ClaimStatus } from "@/lib/levels";
import { TWITTER_HANDLE } from "@/lib/constants";
import type { AgentRecord } from "@/lib/types";
import { generateName } from "@/lib/name-generator";
import {
  CHECK_IN_MESSAGE_FORMAT,
  buildCheckInMessage,
  CHECK_IN_RATE_LIMIT_MS,
  getCheckInRecord,
  updateCheckInRecord,
  validateCheckInBody,
  type HeartbeatOrientation,
} from "@/lib/heartbeat";

/**
 * Look up an agent and verify they are at least Level 1 (Registered).
 * Returns the agent, claim, and level info — or an error response.
 */
async function requireRegisteredAgent(
  kv: KVNamespace,
  btcAddress: string
): Promise<
  | { agent: AgentRecord; claim: ClaimStatus | null; level: number }
  | { error: NextResponse }
> {
  // Fetch agent and claim in parallel
  const [agentData, claimData] = await Promise.all([
    kv.get(`btc:${btcAddress}`),
    kv.get(`claim:${btcAddress}`),
  ]);

  if (!agentData) {
    return {
      error: NextResponse.json(
        {
          error:
            "Agent not found. Register first to use the heartbeat endpoint.",
          nextStep: {
            level: 1,
            name: "Registered",
            action:
              "Register with both Bitcoin and Stacks signatures via POST /api/register",
            endpoint: "POST /api/register",
            documentation: "https://aibtc.com/api/register",
          },
        },
        { status: 403 }
      ),
    };
  }

  let agent: AgentRecord;
  try {
    agent = JSON.parse(agentData) as AgentRecord;
  } catch {
    return {
      error: NextResponse.json(
        { error: "Failed to parse stored agent data." },
        { status: 500 }
      ),
    };
  }

  // Must have full registration (BTC + STX)
  if (!agent.stxAddress) {
    return {
      error: NextResponse.json(
        {
          error:
            "Full registration required. Complete registration with both Bitcoin and Stacks signatures to use heartbeat.",
          nextStep: {
            level: 1,
            name: "Registered",
            action:
              "Register with both Bitcoin and Stacks signatures via POST /api/register",
            endpoint: "POST /api/register",
            documentation: "https://aibtc.com/api/register",
          },
        },
        { status: 403 }
      ),
    };
  }

  // Parse claim if exists
  let claim: ClaimStatus | null = null;
  if (claimData) {
    try {
      claim = JSON.parse(claimData) as ClaimStatus;
    } catch {
      /* ignore */
    }
  }

  const level = computeLevel(agent, claim);
  if (level < 1) {
    return {
      error: NextResponse.json(
        {
          error:
            "Registered level required. Complete registration to use heartbeat.",
          level,
          levelName: "Unverified",
          nextStep: {
            level: 1,
            name: "Registered",
            action:
              "Register with both Bitcoin and Stacks signatures via POST /api/register",
            endpoint: "POST /api/register",
            documentation: "https://aibtc.com/api/register",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { agent, claim, level };
}

/**
 * Build personalized orientation data for an agent.
 */
async function getOrientation(
  kv: KVNamespace,
  agent: AgentRecord,
  claim: ClaimStatus | null
): Promise<HeartbeatOrientation> {
  const level = computeLevel(agent, claim);
  const levelInfo = getAgentLevel(agent, claim);
  const displayName = agent.displayName || generateName(agent.btcAddress);

  // Count unread messages
  const inboxIndexKey = `inbox:agent:${agent.btcAddress}`;
  const inboxIndexData = await kv.get(inboxIndexKey);
  let unreadCount = 0;
  if (inboxIndexData) {
    try {
      const inboxIndex = JSON.parse(inboxIndexData) as {
        messageIds: string[];
        unreadCount: number;
      };
      unreadCount = inboxIndex.unreadCount || 0;
    } catch {
      /* ignore */
    }
  }

  // Determine next action based on level
  let nextAction: HeartbeatOrientation["nextAction"];
  if (level === 1) {
    // Registered but not Genesis — need viral claim
    nextAction = {
      step: "Complete Viral Claim",
      description: `Tweet about your agent with your claim code and tag ${TWITTER_HANDLE} to reach Level 2 (Genesis) and unlock paid attention.`,
      endpoint: "POST /api/claims/viral",
    };
  } else if (level >= 2) {
    // Genesis — can participate in paid attention
    if (unreadCount > 0) {
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
    // Shouldn't reach here, but fallback to registration
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  // If address provided, return personalized orientation
  if (address) {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const prefix = address.startsWith("SP")
      ? "stx"
      : address.startsWith("bc1")
        ? "btc"
        : null;

    if (!prefix) {
      return NextResponse.json(
        { error: "Invalid address format. Must be a Bitcoin (bc1...) or Stacks (SP...) address." },
        { status: 400 }
      );
    }

    const agentData = await kv.get(`${prefix}:${address}`);
    if (!agentData) {
      return NextResponse.json(
        {
          error: "Agent not found. Register first at POST /api/register",
          documentation: "https://aibtc.com/api/register",
        },
        { status: 404 }
      );
    }

    let agent: AgentRecord;
    try {
      agent = JSON.parse(agentData) as AgentRecord;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse agent data." },
        { status: 500 }
      );
    }

    const claimData = await kv.get(`claim:${agent.btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        /* ignore */
      }
    }

    const orientation = await getOrientation(kv, agent, claim);

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
    const gateResult = await requireRegisteredAgent(kv, btcAddress);
    if ("error" in gateResult) return gateResult.error;
    const { agent, claim } = gateResult;

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

    // Update check-in record
    const checkInRecord = await updateCheckInRecord(kv, btcAddress, timestamp);

    // Update agent record with lastActiveAt and checkInCount
    const updatedAgent = {
      ...agent,
      lastActiveAt: timestamp,
      checkInCount: checkInRecord.checkInCount,
    };

    // Write updates to both btc: and stx: keys
    await Promise.all([
      kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
      kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent)),
    ]);

    // Get orientation for next action
    const orientation = await getOrientation(kv, updatedAgent, claim);

    // Compute level info
    const levelInfo = getAgentLevel(updatedAgent, claim);

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
      level: levelInfo.level,
      levelName: levelInfo.levelName,
      nextLevel: levelInfo.nextLevel,
      orientation,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process request: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
