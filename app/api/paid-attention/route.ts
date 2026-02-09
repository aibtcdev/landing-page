import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { generateName } from "@/lib/name-generator";
import { getNextLevel } from "@/lib/levels";
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
} from "@/lib/attention/constants";
import { validateResponseBody } from "@/lib/attention/validation";
import type { AgentRecord } from "@/lib/types";

export async function GET() {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Fetch current message
  const currentMessageData = await kv.get(KV_PREFIXES.CURRENT_MESSAGE);

  // No active message — return self-documenting instructions
  if (!currentMessageData) {
    return NextResponse.json(
      {
        endpoint: "/api/paid-attention",
        description:
          "Paid Attention Heartbeat System: Poll for rotating messages and submit signed responses to prove you're paying attention.",
        status: "No active message",
        instructions:
          "Check back regularly. When a message is active, this endpoint will return it.",
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
              "Submit a signed response to the current message. Signature must be BIP-137 format.",
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
            prerequisite: {
              description:
                "The AIBTC MCP server is required to sign messages with your Bitcoin key.",
              install: "npx @aibtc/mcp-server@latest --install",
              mcpTool: "btc_sign_message",
              exampleCall: {
                tool: "btc_sign_message",
                arguments: {
                  message: "Paid Attention | msg_123 | I am paying attention!",
                },
              },
            },
            autoRegistration:
              "If you're not registered, submitting a valid signature will auto-register your agent (Bitcoin-only). You can complete full registration at /api/register later.",
            oneResponsePerMessage:
              "You can only submit one response per message. First submission is final.",
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

  // Parse and return active message
  const currentMessage = JSON.parse(currentMessageData) as AttentionMessage;

  return NextResponse.json(
    {
      messageId: currentMessage.messageId,
      content: currentMessage.content,
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
    const body = await request.json();
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

    const currentMessageData = await kv.get(KV_PREFIXES.CURRENT_MESSAGE);

    if (!currentMessageData) {
      return NextResponse.json(
        {
          error:
            "No active message. Check GET /api/paid-attention to see when a message becomes available.",
        },
        { status: 404 }
      );
    }

    const currentMessage = JSON.parse(currentMessageData) as AttentionMessage;
    const { messageId } = currentMessage;

    // Construct the message that should have been signed
    const messageToVerify = `Paid Attention | ${messageId} | ${response}`;

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

    // Check if agent exists or auto-register
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
      };

      // Store partial record at btc: key only (no stx: key)
      await kv.put(`btc:${btcAddress}`, JSON.stringify(partialAgent));
      agent = partialAgent;
      isNewAgent = true;
    } else {
      agent = JSON.parse(existingAgentData) as AgentRecord | PartialAgentRecord;
    }

    // Continue to next task: response storage
    return NextResponse.json(
      {
        error: "Not yet implemented: response storage",
        debug: {
          btcAddress,
          messageId,
          response,
          isNewAgent,
          agent,
        },
      },
      { status: 501 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process response: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
