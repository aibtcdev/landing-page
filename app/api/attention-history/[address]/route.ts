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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "20", 10),
      100
    );

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

    const index = JSON.parse(indexData) as AttentionAgentIndex;
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

    const historyItems: AttentionHistoryItem[] = [];

    for (const messageId of reversedIds) {
      // Fetch response
      const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${agent.btcAddress}`;
      const responseData = await kv.get(responseKey);

      // Fetch payout (may not exist)
      const payoutKey = `${KV_PREFIXES.PAYOUT}${messageId}:${agent.btcAddress}`;
      const payoutData = await kv.get(payoutKey);

      // Fetch message content
      const messageKey = `${KV_PREFIXES.MESSAGE}${messageId}`;
      const messageData = await kv.get(messageKey);

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
        console.error(`Failed to parse attention data for ${messageId}:`, e);
        continue;
      }
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
