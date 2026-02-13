import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { KV_PREFIXES } from "@/lib/attention/constants";
import type {
  AttentionResponse,
  AttentionPayout,
  AttentionAgentIndex,
  AttentionMessage,
} from "@/lib/attention/types";

/**
 * Attention history item for API response.
 *
 * Combines response and payout data into a unified activity stream.
 */
interface AttentionHistoryItem {
  type: "response" | "payout";
  messageId: string;
  messageContent: string;
  response?: string;
  satoshis?: number;
  txid?: string;
  timestamp: string;
}

/**
 * GET /api/attention-history/[address]
 *
 * Fetch attention activity history for an agent (responses and payouts).
 *
 * Query params:
 * - limit: number (default 20, max 100)
 *
 * Response:
 * {
 *   btcAddress: string;
 *   displayName: string;
 *   history: AttentionHistoryItem[];
 *   totalResponses: number;
 * }
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ address: string }> }
) {
  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const { address } = await context.params;

    // Parse query params with validation
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    let limit = 20;
    if (limitParam !== null) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    // Resolve agent by BTC or STX address
    const agent = await lookupAgent(kv, address);
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    // Fetch agent's attention index
    const indexData = await kv.get(
      `${KV_PREFIXES.AGENT_INDEX}${agent.btcAddress}`
    );
    if (!indexData) {
      // No attention activity yet
      return NextResponse.json({
        btcAddress: agent.btcAddress,
        displayName: agent.displayName || agent.btcAddress,
        history: [],
        totalResponses: 0,
      });
    }

    let index: AttentionAgentIndex;
    try {
      index = JSON.parse(indexData) as AttentionAgentIndex;
    } catch (e) {
      console.error(
        `Failed to parse AttentionAgentIndex for ${agent.btcAddress}:`,
        e
      );
      return NextResponse.json(
        { error: "Failed to parse agent attention index" },
        { status: 500 }
      );
    }

    const messageIds = index.messageIds || [];

    if (messageIds.length === 0) {
      return NextResponse.json({
        btcAddress: agent.btcAddress,
        displayName: agent.displayName || agent.btcAddress,
        history: [],
        totalResponses: 0,
      });
    }

    // Fetch responses, payouts, and messages for each messageId
    // Process in reverse order (newest first)
    const reversedIds = [...messageIds].reverse().slice(0, limit);

    // Parallelize KV fetches for all messageIds
    const fetchPromises = reversedIds.map(async (messageId) => {
      const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${agent.btcAddress}`;
      const payoutKey = `${KV_PREFIXES.PAYOUT}${messageId}:${agent.btcAddress}`;
      const messageKey = `${KV_PREFIXES.MESSAGE}${messageId}`;

      const [responseData, payoutData, messageData] = await Promise.all([
        kv.get(responseKey),
        kv.get(payoutKey),
        kv.get(messageKey),
      ]);

      return { messageId, responseData, payoutData, messageData };
    });

    const fetchResults = await Promise.all(fetchPromises);
    const historyItems: AttentionHistoryItem[] = [];
    let failedParseCount = 0;

    for (const { messageId, responseData, payoutData, messageData } of fetchResults) {
      if (!responseData) continue; // Skip if response is missing

      try {
        const response = JSON.parse(responseData) as AttentionResponse;
        const payout = payoutData
          ? (JSON.parse(payoutData) as AttentionPayout)
          : null;
        const message = messageData
          ? (JSON.parse(messageData) as AttentionMessage)
          : null;

        const messageContent =
          message?.content || "Message content unavailable";

        // Add response item
        historyItems.push({
          type: "response",
          messageId,
          messageContent,
          response: response.response,
          timestamp: response.submittedAt,
        });

        // Add payout item if exists
        if (payout) {
          historyItems.push({
            type: "payout",
            messageId,
            messageContent,
            satoshis: payout.rewardSatoshis,
            txid: payout.rewardTxid,
            timestamp: payout.paidAt,
          });
        }
      } catch (e) {
        failedParseCount++;
        console.error(`Failed to parse attention data for ${messageId}:`, e);
        continue;
      }
    }

    if (failedParseCount > 0) {
      console.warn(
        `Failed to parse ${failedParseCount} attention records for ${agent.btcAddress}`
      );
    }

    // Sort by timestamp (newest first)
    historyItems.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({
      btcAddress: agent.btcAddress,
      displayName: agent.displayName || agent.btcAddress,
      history: historyItems,
      totalResponses: messageIds.length,
    });
  } catch (error) {
    console.error("Error fetching attention history:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
