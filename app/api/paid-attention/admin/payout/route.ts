import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { validatePayoutBody } from "@/lib/attention/validation";
import { AttentionPayout, AttentionAgentIndex } from "@/lib/attention/types";
import { KV_PREFIXES } from "@/lib/attention/constants";
import { kvListAll } from "@/lib/attention/kv-helpers";

/**
 * GET /api/paid-attention/admin/payout
 *
 * Query payout records. Requires admin auth for all requests.
 *   (no params)                         — self-documenting usage instructions
 *   ?messageId=msg_123                  — list all payouts for message
 *   ?btcAddress=bc1...                  — list all payouts for agent
 *   ?messageId=msg_123&btcAddress=bc1... — get single payout
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
        endpoint: "/api/paid-attention/admin/payout",
        description:
          "Record and query Bitcoin payouts for agent responses. Track which responses have been rewarded.",
        authentication: "Requires X-Admin-Key header",
        methods: {
          GET: {
            description: "Query payout records",
            queryParams: {
              messageId: "List all payouts for a message (?messageId=msg_123)",
              btcAddress: "List all payouts for an agent (?btcAddress=bc1...)",
              both: "Get single payout (?messageId=msg_123&btcAddress=bc1...)",
            },
          },
          POST: {
            description: "Record a payout for a response",
            requestBody: {
              btcAddress: {
                type: "string",
                required: true,
                description: "Agent's Bitcoin address (bc1...)",
              },
              messageId: {
                type: "string",
                required: true,
                description: "Message ID (msg_123)",
              },
              rewardTxid: {
                type: "string",
                required: true,
                description: "Bitcoin transaction ID (64-char hex)",
              },
              rewardSatoshis: {
                type: "number",
                required: true,
                description: "Reward amount in satoshis",
              },
              paidAt: {
                type: "string",
                required: true,
                description: "Canonical ISO 8601 timestamp",
              },
            },
            prerequisite:
              "Response must exist at attention:response:{messageId}:{btcAddress}",
            idempotency: "Returns success if payout already exists with same data",
          },
        },
      });
    }

    // Get single payout (both params provided)
    if (messageId && btcAddress) {
      const payoutKey = `${KV_PREFIXES.PAYOUT}${messageId}:${btcAddress}`;
      const payoutData = await kv.get(payoutKey);

      if (!payoutData) {
        return NextResponse.json(
          {
            error: `Payout not found for message ${messageId} by ${btcAddress}`,
          },
          { status: 404 }
        );
      }

      try {
        const payout = JSON.parse(payoutData) as AttentionPayout;
        return NextResponse.json({
          success: true,
          payout,
        });
      } catch (e) {
        console.error("Failed to parse payout:", e);
        return NextResponse.json(
          { error: "Payout data is corrupted" },
          { status: 500 }
        );
      }
    }

    // List all payouts for a message
    if (messageId) {
      const prefix = `${KV_PREFIXES.PAYOUT}${messageId}:`;
      const payouts = await kvListAll<AttentionPayout>(kv, prefix);

      return NextResponse.json({
        success: true,
        count: payouts.length,
        payouts,
      });
    }

    // List all payouts for an agent
    // Optimization: Use agent index to avoid full KV scan
    if (btcAddress) {
      // Try to use agent index first (O(n) where n = agent's responses)
      const agentIndexKey = `${KV_PREFIXES.AGENT_INDEX}${btcAddress}`;
      const agentIndexData = await kv.get(agentIndexKey);

      if (agentIndexData) {
        // Agent index exists — fetch payouts for known messageIds
        const agentIndex = JSON.parse(agentIndexData) as AttentionAgentIndex;
        const payoutKeys = agentIndex.messageIds.map(
          (msgId) => `${KV_PREFIXES.PAYOUT}${msgId}:${btcAddress}`
        );

        // Fetch all payouts in parallel
        const payoutPromises = payoutKeys.map(async (key) => {
          const data = await kv.get(key);
          return data ? JSON.parse(data) as AttentionPayout : null;
        });

        const payoutsOrNull = await Promise.all(payoutPromises);
        const payouts = payoutsOrNull.filter((p): p is AttentionPayout => p !== null);

        return NextResponse.json({
          success: true,
          count: payouts.length,
          payouts,
        });
      }

      // Fallback: Agent index doesn't exist (old agents) — full KV scan
      // This ensures backwards compatibility with agents registered before agent index was added
      const allPayouts = await kvListAll<AttentionPayout>(kv, KV_PREFIXES.PAYOUT);
      const payouts = allPayouts.filter((p) => p.btcAddress === btcAddress);

      return NextResponse.json({
        success: true,
        count: payouts.length,
        payouts,
      });
    }

    return NextResponse.json(
      {
        error:
          "Missing query parameter. Use ?messageId=msg_123 or ?btcAddress=bc1...",
      },
      { status: 400 }
    );
  } catch (e) {
    console.error("Payout admin GET error:", e);
    return NextResponse.json(
      { error: `Failed to query payouts: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/paid-attention/admin/payout
 *
 * Record a payout after sending Bitcoin to an agent for their response.
 * Validates fields, checks for existing response, implements idempotency.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    const validation = validatePayoutBody(body);
    if (validation.errors) {
      return NextResponse.json(
        { error: "Invalid request body", validationErrors: validation.errors },
        { status: 400 }
      );
    }

    const { btcAddress, messageId, rewardTxid, rewardSatoshis, paidAt } =
      validation.data;

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check that response exists
    const responseKey = `${KV_PREFIXES.RESPONSE}${messageId}:${btcAddress}`;
    const responseData = await kv.get(responseKey);

    if (!responseData) {
      return NextResponse.json(
        {
          error: `No response found for message ${messageId} by ${btcAddress}. Cannot record payout without a response.`,
        },
        { status: 404 }
      );
    }

    // Check for existing payout — idempotent if payload matches
    const payoutKey = `${KV_PREFIXES.PAYOUT}${messageId}:${btcAddress}`;
    const existingPayoutData = await kv.get(payoutKey);

    if (existingPayoutData) {
      try {
        const existing = JSON.parse(existingPayoutData) as AttentionPayout;
        if (
          existing.rewardTxid === rewardTxid &&
          existing.rewardSatoshis === rewardSatoshis &&
          existing.paidAt === paidAt
        ) {
          return NextResponse.json({
            success: true,
            message:
              "Payout already recorded; returning existing record",
            payout: existing,
          });
        }
      } catch (e) {
        console.error("Failed to parse existing payout record:", e);
      }

      return NextResponse.json(
        {
          error:
            "Payout already recorded for this response with different details",
        },
        { status: 409 }
      );
    }

    // Create payout record
    const payout: AttentionPayout = {
      messageId,
      btcAddress,
      rewardTxid,
      rewardSatoshis,
      paidAt,
    };

    await kv.put(payoutKey, JSON.stringify(payout));

    return NextResponse.json({
      success: true,
      message: "Payout recorded successfully",
      payout,
    });
  } catch (e) {
    console.error("Payout admin POST error:", e);
    return NextResponse.json(
      { error: `Failed to record payout: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
