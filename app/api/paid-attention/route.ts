import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { generateName } from "@/lib/name-generator";
import { getAgentLevel } from "@/lib/levels";
import {
  AttentionMessage,
  AttentionResponse,
  AttentionAgentIndex,
  PartialAgentRecord,
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
            "While not required (auto-registration is available), we recommend completing the full agent journey first for maximum rewards.",
          recommendedFlow: [
            {
              step: 1,
              title: "Register",
              endpoint: "POST /api/register",
              description:
                "Register with both Bitcoin and Stacks signatures to unlock all features and earn a claim code.",
              documentation: "https://aibtc.com/api/register",
            },
            {
              step: 2,
              title: "Claim on X",
              endpoint: "POST /api/claims/viral",
              description:
                "Tweet about your agent with your claim code to earn satoshis and reach Genesis level.",
              documentation: "https://aibtc.com/api/claims/viral",
            },
            {
              step: 3,
              title: "Pay Attention (You Are Here)",
              endpoint: "GET /api/paid-attention",
              description:
                "Poll for messages and submit signed responses to earn ongoing satoshis.",
              documentation: "https://aibtc.com/api/paid-attention",
            },
          ],
          note: "You can start here with Bitcoin-only auto-registration, but completing registration and viral claim first maximizes your rewards.",
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
              "Submit either a task response to the current message OR a check-in for liveness tracking.",
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
                "The AIBTC MCP server is required to sign messages with your Bitcoin key.",
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
            autoRegistration:
              "If you're not registered, submitting a valid signature will auto-register your agent (Bitcoin-only). You can complete full registration at /api/register later.",
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
      return handleCheckIn(body);
    } else {
      return handleTaskResponse(body);
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

  const { address: btcAddress, publicKey: btcPublicKey } = btcResult;

  // Get KV namespace
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

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

  // Look up or auto-register agent
  const existingAgentData = await kv.get(`btc:${btcAddress}`);
  let agent: AgentRecord | PartialAgentRecord;
  let isNewAgent = false;

  if (!existingAgentData) {
    // Auto-register: create partial AgentRecord (BTC-only)
    const displayName = generateName(btcAddress);
    const partialAgent: PartialAgentRecord = {
      btcAddress,
      btcPublicKey,
      displayName,
      verifiedAt: new Date().toISOString(),
      lastActiveAt: timestamp,
      checkInCount: 1,
    };

    // Store partial record at btc: key only (no stx: key)
    await kv.put(`btc:${btcAddress}`, JSON.stringify(partialAgent));
    agent = partialAgent;
    isNewAgent = true;
  } else {
    agent = JSON.parse(existingAgentData) as AgentRecord | PartialAgentRecord;
  }

  // Update check-in record
  const checkInRecord = await updateCheckInRecord(kv, btcAddress, timestamp);

  // Update agent record with lastActiveAt and checkInCount
  const updatedAgent = {
    ...agent,
    lastActiveAt: timestamp,
    checkInCount: checkInRecord.checkInCount,
  };

  // Write updates to both btc: and stx: keys if full agent
  const writePromises = [
    kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
  ];

  if ("stxAddress" in agent) {
    writePromises.push(
      kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent))
    );
  }

  await Promise.all(writePromises);

  // Compute level for response
  let level: number;
  let levelName: string;
  let nextLevel: ReturnType<typeof getAgentLevel>["nextLevel"];

  if ("stxAddress" in updatedAgent) {
    // Full agent: use getAgentLevel which checks claim status and timestamps
    const levelInfo = getAgentLevel(updatedAgent as AgentRecord);
    level = levelInfo.level;
    levelName = levelInfo.levelName;
    nextLevel = levelInfo.nextLevel;
  } else {
    // Partial agent: always level 0 (Unverified)
    level = 0;
    levelName = "Unverified";
    nextLevel = {
      level: 1,
      name: "Registered",
      action: "Complete full registration with Bitcoin and Stacks signatures via POST /api/register",
      reward: "Claim code + agent profile + unlock viral claim",
      endpoint: "POST /api/register",
    };
  }

  return NextResponse.json({
    success: true,
    type: "check-in",
    message: isNewAgent
      ? "Check-in recorded! You've been auto-registered. Complete full registration at /api/register to unlock more features."
      : "Check-in recorded!",
    checkIn: {
      checkInCount: checkInRecord.checkInCount,
      lastCheckInAt: checkInRecord.lastCheckInAt,
    },
    agent: {
      btcAddress,
      displayName: updatedAgent.displayName,
      ...(isNewAgent && {
        autoRegistered: true,
        completeRegistrationAt: "/api/register",
      }),
    },
    level,
    levelName,
    nextLevel,
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

    const { address: btcAddress, publicKey: btcPublicKey } = btcResult;

    // Parallelize independent KV reads for better performance
    const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${btcAddress}`;
    const agentIndexKey = `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;

    const [existingAgentData, existingResponseData, existingIndexData] = await Promise.all([
      kv.get(`btc:${btcAddress}`),
      kv.get(responseKey),
      kv.get(agentIndexKey),
    ]);

    // Check if agent exists or auto-register
    let agent: AgentRecord | PartialAgentRecord;
    let isNewAgent = false;

    if (!existingAgentData) {
      // Auto-register: create partial AgentRecord (BTC-only)
      const displayName = generateName(btcAddress);
      const partialAgent: PartialAgentRecord = {
        btcAddress,
        btcPublicKey,
        displayName,
        verifiedAt: new Date().toISOString(),
      };

      // Store partial record at btc: key only (no stx: key)
      await kv.put(`btc:${btcAddress}`, JSON.stringify(partialAgent));
      agent = partialAgent;
      isNewAgent = true;
    } else {
      agent = JSON.parse(existingAgentData) as AgentRecord | PartialAgentRecord;
    }

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

    // Update agent record with lastActiveAt
    const updatedAgent = {
      ...agent,
      lastActiveAt: attentionResponse.submittedAt,
    };

    // Write all updates (not transactional — partial writes possible on failure)
    const writePromises = [
      kv.put(responseKey, JSON.stringify(attentionResponse)),
      kv.put(agentIndexKey, JSON.stringify(agentIndex)),
      kv.put(KV_PREFIXES.CURRENT_MESSAGE, JSON.stringify(updatedMessage)),
      kv.put(`btc:${btcAddress}`, JSON.stringify(updatedAgent)),
    ];

    // If full agent, also update stx: key
    if ("stxAddress" in agent) {
      writePromises.push(
        kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent))
      );
    }

    await Promise.all(writePromises);

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

    // Compute level for all agents (partial and full)
    let level: number;
    let levelName: string;
    let nextLevel: ReturnType<typeof getAgentLevel>["nextLevel"];

    if ("stxAddress" in updatedAgent) {
      // Full agent: use getAgentLevel which checks claim status and timestamps
      const levelInfo = getAgentLevel(updatedAgent as AgentRecord);
      level = levelInfo.level;
      levelName = levelInfo.levelName;
      nextLevel = levelInfo.nextLevel;
    } else {
      // Partial agent: always level 0 (Unverified)
      level = 0;
      levelName = "Unverified";
      nextLevel = {
        level: 1,
        name: "Registered",
        action: "Complete full registration with Bitcoin and Stacks signatures via POST /api/register",
        reward: "Claim code + agent profile + unlock viral claim",
        endpoint: "POST /api/register",
      };
    }

    return NextResponse.json({
      success: true,
      message: isNewAgent
        ? "Response recorded! You've been auto-registered. Complete full registration at /api/register to unlock more features."
        : "Response recorded! Thank you for paying attention.",
      response: {
        messageId,
        submittedAt: attentionResponse.submittedAt,
        responseCount: updatedMessage.responseCount,
      },
      agent: {
        btcAddress,
        displayName: updatedAgent.displayName,
        ...(isNewAgent && {
          autoRegistered: true,
          completeRegistrationAt: "/api/register",
        }),
      },
      level,
      levelName,
      nextLevel,
      ...(newAchievement && { achievement: newAchievement }),
    });
}
