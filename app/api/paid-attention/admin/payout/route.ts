import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { validatePayoutBody } from "@/lib/attention/validation";
import { AttentionPayout } from "@/lib/attention/types";
import { KV_PREFIXES } from "@/lib/attention/constants";

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
      const payouts: AttentionPayout[] = [];
      let cursor: string | undefined;
      let listComplete = false;

      const prefix = `${KV_PREFIXES.PAYOUT}${messageId}:`;

      do {
        const opts: KVNamespaceListOptions = { prefix };
        if (cursor) opts.cursor = cursor;
        const page = await kv.list(opts);
        const BATCH_SIZE = 20;

        for (let i = 0; i < page.keys.length; i += BATCH_SIZE) {
          const batch = page.keys.slice(i, i + BATCH_SIZE);
          const batchData = await Promise.all(
            batch.map((key) => kv.get(key.name))
          );

          batchData.forEach((payoutData, index) => {
            if (payoutData) {
              try {
                payouts.push(JSON.parse(payoutData) as AttentionPayout);
              } catch (e) {
                console.error(`Failed to parse payout ${batch[index].name}:`, e);
              }
            }
          });
        }

        listComplete = page.list_complete;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (!listComplete);

      return NextResponse.json({
        success: true,
        count: payouts.length,
        payouts,
      });
    }

    // List all payouts for an agent (read all, filter in-memory)
    if (btcAddress) {
      const payouts: AttentionPayout[] = [];
      let cursor: string | undefined;
      let listComplete = false;

      do {
        const opts: KVNamespaceListOptions = { prefix: KV_PREFIXES.PAYOUT };
        if (cursor) opts.cursor = cursor;
        const page = await kv.list(opts);
        const BATCH_SIZE = 20;

        for (let i = 0; i < page.keys.length; i += BATCH_SIZE) {
          const batch = page.keys.slice(i, i + BATCH_SIZE);
          const batchData = await Promise.all(
            batch.map((key) => kv.get(key.name))
          );

          batchData.forEach((payoutData, index) => {
            if (payoutData) {
              try {
                const payout = JSON.parse(payoutData) as AttentionPayout;
                if (payout.btcAddress === btcAddress) {
                  payouts.push(payout);
                }
              } catch (e) {
                console.error(`Failed to parse payout ${batch[index].name}:`, e);
              }
            }
          });
        }

        listComplete = page.list_complete;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (!listComplete);

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
