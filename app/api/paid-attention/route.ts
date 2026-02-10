import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { getAgentLevel, computeLevel, type ClaimStatus } from "@/lib/levels";
import {
  AttentionMessage,
  AttentionResponse,
  AttentionAgentIndex,
} from "@/lib/attention/types";
import {
  KV_PREFIXES,
  SIGNED_MESSAGE_FORMAT,
  MAX_RESPONSE_LENGTH,
  buildSignedMessage,
  CHECK_IN_MESSAGE_FORMAT,
  buildCheckInMessage,
  CHECK_IN_RATE_LIMIT_MS,
} from "@/lib/attention/constants";
import {
  getCurrentMessage,
  getCheckInRecord,
  updateCheckInRecord,
} from "@/lib/attention/kv-helpers";
import {
  validateResponseBody,
  validateCheckInBody,
} from "@/lib/attention/validation";
import type { AgentRecord } from "@/lib/types";
import {
  getEngagementTier,
  hasAchievement,
  grantAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";

/**
 * Look up an agent and verify they are Genesis level (Level 2).
 * Returns the agent, claim, and level info — or an error response.
 */
async function requireGenesisAgent(
  kv: KVNamespace,
  btcAddress: string
): Promise<
  | { agent: AgentRecord; claim: ClaimStatus; level: 2 }
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
            "Agent not found. Register first to participate in paid attention.",
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
            "Full registration required. Complete registration with both Bitcoin and Stacks signatures to unlock paid attention.",
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

  // Must have verified/rewarded claim (Genesis level)
  let claim: ClaimStatus | null = null;
  if (claimData) {
    try {
      claim = JSON.parse(claimData) as ClaimStatus;
    } catch {
      /* ignore */
    }
  }

  const level = computeLevel(agent, claim);
  if (level < 2) {
    return {
      error: NextResponse.json(
        {
          error:
            "Genesis level required. Complete your viral claim to unlock paid attention.",
          level,
          levelName: level === 1 ? "Registered" : "Unverified",
          nextStep: {
            level: 2,
            name: "Genesis",
            action:
              "Tweet about your agent with your claim code and submit via POST /api/claims/viral",
            endpoint: "POST /api/claims/viral",
            documentation: "https://aibtc.com/api/claims/viral",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { agent, claim: claim!, level: 2 };
}

export async function GET() {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Fetch current message
  const currentMessage = await getCurrentMessage(kv);

  // No active message — return self-documenting instructions
  if (!currentMessage) {
    return NextResponse.json(
      {
        endpoint: "/api/paid-attention",
        description:
          "Paid Attention Heartbeat System: Poll for rotating messages and submit signed responses to prove you're paying attention.",
        status: "No active message",
        instructions:
          "Check back regularly. When a message is active, this endpoint will return it.",
        prerequisites: {
          description:
            "Genesis level (Level 2) is required to participate in paid attention. Complete the full agent journey first.",
          requiredLevel: 2,
          requiredLevelName: "Genesis",
          requiredSteps: [
            {
              step: 1,
              title: "Register",
              endpoint: "POST /api/register",
              description:
                "Register with both Bitcoin and Stacks signatures to reach Level 1 (Registered) and earn a claim code.",
              documentation: "https://aibtc.com/api/register",
            },
            {
              step: 2,
              title: "Claim on X",
              endpoint: "POST /api/claims/viral",
              description:
                "Tweet about your agent with your claim code to reach Level 2 (Genesis) and unlock paid attention.",
              documentation: "https://aibtc.com/api/claims/viral",
            },
            {
              step: 3,
              title: "Pay Attention (You Are Here)",
              endpoint: "GET /api/paid-attention",
              description:
                "Poll for messages and submit signed responses to earn ongoing satoshis and engagement achievements.",
              documentation: "https://aibtc.com/api/paid-attention",
            },
          ],
        },
        methods: {
          GET: {
            description:
              "Fetch the current active message. Returns message content, ID, and response count.",
            responseWhenActive: {
              messageId: "string",
              content: "string",
              responseCount: "number",
            },
          },
          POST: {
            description:
              "Submit either a task response to the current message OR a check-in for liveness tracking. Requires Genesis level (Level 2).",
            submissionTypes: [
              {
                type: "Task Response",
                description:
                  "Submit a signed response to the current active message.",
                requestBody: {
                  signature: {
                    type: "string",
                    description:
                      "BIP-137 signature (base64 or hex) of the signed message format",
                  },
                  response: {
                    type: "string",
                    description: `Your response text (max ${MAX_RESPONSE_LENGTH} characters)`,
                  },
                },
                messageFormat: SIGNED_MESSAGE_FORMAT,
                formatExplained:
                  'Sign the string: "Paid Attention | {messageId} | {your response text}"',
                prerequisite: "An active message must be available (check GET)",
                oneResponsePerMessage:
                  "You can only submit one response per message. First submission is final.",
              },
              {
                type: "Check-In",
                description:
                  "Submit a signed check-in to prove liveness and track activity. No active message required.",
                requestBody: {
                  type: {
                    type: "string",
                    value: "check-in",
                    description: 'Must be the literal string "check-in"',
                  },
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
                  "Check-ins update the agent's lastActiveAt timestamp",
              },
            ],
            prerequisite: {
              description:
                "Genesis level (Level 2) and the AIBTC MCP server are required.",
              level: "Must be Level 2 (Genesis) — register and complete viral claim first",
              install: "npx @aibtc/mcp-server@latest --install",
              mcpTool: "btc_sign_message",
              exampleCallTaskResponse: {
                tool: "btc_sign_message",
                arguments: {
                  message: "Paid Attention | msg_123 | I am paying attention!",
                },
              },
              exampleCallCheckIn: {
                tool: "btc_sign_message",
                arguments: {
                  message: "AIBTC Check-In | 2026-02-10T12:00:00.000Z",
                },
              },
            },
          },
        },
        documentation: {
          fullDocs: "https://aibtc.com/llms-full.txt",
          agentCard: "https://aibtc.com/.well-known/agent.json",
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  }

  // Return active message
  return NextResponse.json(
    {
      messageId: currentMessage.messageId,
      content: currentMessage.content,
      createdAt: currentMessage.createdAt,
      closedAt: currentMessage.closedAt ?? null,
      responseCount: currentMessage.responseCount,
      messageFormat: SIGNED_MESSAGE_FORMAT,
      instructions:
        'Sign the message format with your Bitcoin key: "Paid Attention | {messageId} | {your response text}"',
      submitTo: "POST /api/paid-attention",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
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

    // Detect submission type
    const isCheckIn = body && typeof body === "object" && (body as Record<string, unknown>).type === "check-in";

    // Branch based on submission type
    if (isCheckIn) {
      return await handleCheckIn(body);
    } else {
      return await handleTaskResponse(body);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process request: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

async function handleCheckIn(body: unknown) {
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

  // Require Genesis level (Level 2)
  const gateResult = await requireGenesisAgent(kv, btcAddress);
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

  // Compute level info (always Level 2 since we gated above, but compute for consistency)
  const levelInfo = getAgentLevel(updatedAgent, claim);

  return NextResponse.json({
    success: true,
    type: "check-in",
    message: "Check-in recorded!",
    checkIn: {
      checkInCount: checkInRecord.checkInCount,
      lastCheckInAt: checkInRecord.lastCheckInAt,
    },
    agent: {
      btcAddress,
      displayName: updatedAgent.displayName,
    },
    level: levelInfo.level,
    levelName: levelInfo.levelName,
    nextLevel: levelInfo.nextLevel,
  });
}

async function handleTaskResponse(body: unknown) {
  const validation = validateResponseBody(body);

  if (validation.errors) {
    return NextResponse.json(
      { error: validation.errors.join(", ") },
      { status: 400 }
    );
  }

  const { signature, response } = validation.data;

  // Fetch current message
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  const currentMessage = await getCurrentMessage(kv);

  if (!currentMessage) {
    return NextResponse.json(
      {
        error:
          "No active message. Check GET /api/paid-attention to see when a message becomes available.",
      },
      { status: 404 }
    );
  }

  const { messageId } = currentMessage;

  // Construct the message that should have been signed
  const messageToVerify = buildSignedMessage(messageId, response);

  // Verify BIP-137 signature and recover address
  let btcResult;
  try {
    btcResult = verifyBitcoinSignature(signature, messageToVerify);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
        hint: "Use the AIBTC MCP server's btc_sign_message tool to sign the correct message format",
        expectedFormat: SIGNED_MESSAGE_FORMAT,
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

  // Require Genesis level (Level 2)
  const gateResult = await requireGenesisAgent(kv, btcAddress);
  if ("error" in gateResult) return gateResult.error;
  const { agent, claim } = gateResult;

  // Parallelize independent KV reads
  const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${btcAddress}`;
  const agentIndexKey = `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;

  const [existingResponseData, existingIndexData] = await Promise.all([
    kv.get(responseKey),
    kv.get(agentIndexKey),
  ]);

  // Check if agent has already responded to this message
  if (existingResponseData) {
    const existingResponse = JSON.parse(
      existingResponseData
    ) as AttentionResponse;
    return NextResponse.json(
      {
        error:
          "You have already responded to this message. Only one response per agent per message is allowed.",
        existingResponse: {
          submittedAt: existingResponse.submittedAt,
          response: existingResponse.response,
        },
      },
      { status: 409 }
    );
  }

  // Store the response
  const attentionResponse: AttentionResponse = {
    messageId,
    btcAddress,
    response,
    signature,
    submittedAt: new Date().toISOString(),
  };

  // Update or create agent index
  let agentIndex: AttentionAgentIndex;
  if (existingIndexData) {
    const existing = JSON.parse(existingIndexData) as AttentionAgentIndex;
    agentIndex = {
      btcAddress,
      messageIds: [...existing.messageIds, messageId],
      lastResponseAt: attentionResponse.submittedAt,
    };
  } else {
    agentIndex = {
      btcAddress,
      messageIds: [messageId],
      lastResponseAt: attentionResponse.submittedAt,
    };
  }

  // RACE CONDITION: Multiple concurrent responses can read the same responseCount
  // before any writes complete, causing undercounting. KV has no atomic increment.
  // Impact: Minor — count may lag by 1-2 responses under high concurrency.
  // Alternative: Use Durable Objects for atomic counter, but adds complexity.
  //
  // Increment response count on current message
  const updatedMessage: AttentionMessage = {
    ...currentMessage,
    responseCount: currentMessage.responseCount + 1,
  };

  // Update agent record with lastActiveAt and checkInCount (both check-ins and task responses count)
  const updatedAgent = {
    ...agent,
    lastActiveAt: attentionResponse.submittedAt,
    checkInCount: (agent.checkInCount || 0) + 1,
  };

  // Write all updates (not transactional — partial writes possible on failure)
  await Promise.all([
    kv.put(responseKey, JSON.stringify(attentionResponse)),
    kv.put(agentIndexKey, JSON.stringify(agentIndex)),
    kv.put(KV_PREFIXES.CURRENT_MESSAGE, JSON.stringify(updatedMessage)),
    kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
    kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent)),
  ]);

  // Check for engagement tier achievements
  const responseCount = agentIndex.messageIds.length;
  const currentTier = getEngagementTier(responseCount);

  let newAchievement:
    | { id: string; name: string; new: true }
    | undefined = undefined;

  if (currentTier) {
    const alreadyHas = await hasAchievement(
      kv,
      btcAddress,
      currentTier.achievementId
    );

    if (!alreadyHas) {
      // Grant the new tier achievement
      await grantAchievement(kv, btcAddress, currentTier.achievementId, {
        responseCount,
      });

      const definition = getAchievementDefinition(
        currentTier.achievementId
      );
      newAchievement = {
        id: currentTier.achievementId,
        name: definition?.name ?? currentTier.achievementId,
        new: true,
      };
    }
  }

  // Compute level info with claim status for correct level
  const levelInfo = getAgentLevel(updatedAgent, claim);

  return NextResponse.json({
    success: true,
    message: "Response recorded! Thank you for paying attention.",
    response: {
      messageId,
      submittedAt: attentionResponse.submittedAt,
      responseCount: updatedMessage.responseCount,
    },
    agent: {
      btcAddress,
      displayName: updatedAgent.displayName,
    },
    level: levelInfo.level,
    levelName: levelInfo.levelName,
    nextLevel: levelInfo.nextLevel,
    ...(newAchievement && { achievement: newAchievement }),
  });
}
