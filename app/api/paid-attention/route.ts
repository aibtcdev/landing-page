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
