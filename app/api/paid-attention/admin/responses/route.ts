import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import {
  AttentionResponse,
  AttentionAgentIndex,
} from "@/lib/attention/types";
import { KV_PREFIXES } from "@/lib/attention/constants";
import { kvListAll } from "@/lib/attention/kv-helpers";

/**
 * GET /api/paid-attention/admin/responses
 *
 * Query agent responses. Requires admin auth for all requests.
 *   (no params)                         — self-documenting usage instructions
 *   ?messageId=msg_123                  — list all responses for message
 *   ?btcAddress=bc1...                  — list all responses by agent
 *   ?messageId=msg_123&btcAddress=bc1... — get single response
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId");
    const btcAddress = searchParams.get("btcAddress");

    // Self-documentation
    if (!messageId && !btcAddress) {
      return NextResponse.json({
        endpoint: "/api/paid-attention/admin/responses",
        description:
          "Query agent responses to attention messages. Check payout status for each response.",
        authentication: "Requires X-Admin-Key header",
        methods: {
          GET: {
            description: "Query responses",
            queryParams: {
              messageId:
                "List all responses for a message (?messageId=msg_123)",
              btcAddress:
                "List all responses by an agent (?btcAddress=bc1...)",
              both: "Get single response (?messageId=msg_123&btcAddress=bc1...)",
            },
            responseFields: {
              response: "The AttentionResponse record",
              hasPayout:
                "Boolean indicating if payout has been recorded for this response",
            },
          },
        },
      });
    }

    // Get single response (both params provided)
    if (messageId && btcAddress) {
      const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${btcAddress}`;
      const responseData = await kv.get(responseKey);

      if (!responseData) {
        return NextResponse.json(
          { error: `Response not found for message ${messageId} by ${btcAddress}` },
          { status: 404 }
        );
      }

      try {
        const response = JSON.parse(responseData) as AttentionResponse;

        // Check if payout exists
        const payoutKey = `${KV_PREFIXES.PAYOUT}${messageId}:${btcAddress}`;
        const payoutData = await kv.get(payoutKey);
        const hasPayout = !!payoutData;

        return NextResponse.json({
          success: true,
          response,
          hasPayout,
        });
      } catch (e) {
        console.error("Failed to parse response:", e);
        return NextResponse.json(
          { error: "Response data is corrupted" },
          { status: 500 }
        );
      }
    }

    // List all responses for a message
    if (messageId) {
      const prefix = `${KV_PREFIXES.RESPONSE}${messageId}:`;
      const responsesData = await kvListAll<AttentionResponse>(kv, prefix);

      // Batch check payout status for all responses
      const payoutKeys = responsesData.map(
        (r) => `${KV_PREFIXES.PAYOUT}${r.messageId}:${r.btcAddress}`
      );
      const payoutResults = await Promise.all(
        payoutKeys.map((key) => kv.get(key))
      );

      // Combine responses with payout status
      const responses = responsesData.map((response, i) => ({
        ...response,
        hasPayout: !!payoutResults[i],
      }));

      return NextResponse.json({
        success: true,
        count: responses.length,
        responses,
      });
    }

    // List all responses by an agent (via agent index)
    if (btcAddress) {
      const agentIndexKey = `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;
      const agentIndexData = await kv.get(agentIndexKey);

      if (!agentIndexData) {
        return NextResponse.json({
          success: true,
          count: 0,
          responses: [],
        });
      }

      try {
        const agentIndex = JSON.parse(agentIndexData) as AttentionAgentIndex;
        const messageIds = agentIndex.messageIds;

        // Batch fetch all responses
        const responseKeys = messageIds.map(
          (msgId) => `${KV_PREFIXES.RESPONSE}${msgId}:${btcAddress}`
        );
        const responseDataArray = await Promise.all(
          responseKeys.map((key) => kv.get(key))
        );

        // Parse responses
        const parsedResponses: AttentionResponse[] = [];
        for (let i = 0; i < responseDataArray.length; i++) {
          const responseData = responseDataArray[i];
          if (responseData) {
            try {
              parsedResponses.push(JSON.parse(responseData) as AttentionResponse);
            } catch (e) {
              console.error(`Failed to parse response for ${messageIds[i]}:`, e);
            }
          }
        }

        // Batch check payout status
        const payoutKeys = parsedResponses.map(
          (r) => `${KV_PREFIXES.PAYOUT}${r.messageId}:${r.btcAddress}`
        );
        const payoutResults = await Promise.all(
          payoutKeys.map((key) => kv.get(key))
        );

        // Combine responses with payout status
        const responses = parsedResponses.map((response, i) => ({
          ...response,
          hasPayout: !!payoutResults[i],
        }));

        return NextResponse.json({
          success: true,
          count: responses.length,
          responses,
        });
      } catch (e) {
        console.error("Failed to parse agent index:", e);
        return NextResponse.json(
          { error: "Agent index data is corrupted" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        error:
          "Missing query parameter. Use ?messageId=msg_123 or ?btcAddress=bc1...",
      },
      { status: 400 }
    );
  } catch (e) {
    console.error("Responses admin GET error:", e);
    return NextResponse.json(
      { error: `Failed to query responses: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
