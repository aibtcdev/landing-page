import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateAdmin } from "@/lib/admin/auth";
import { validateGenesisPayoutBody } from "@/lib/admin/validation";
import { GenesisPayoutRecord } from "@/lib/admin/types";

interface ClaimRecord {
  btcAddress: string;
  displayName: string;
  tweetUrl: string;
  tweetAuthor: string | null;
  claimedAt: string;
  rewardSatoshis: number;
  rewardTxid: string | null;
  status: "pending" | "verified" | "rewarded" | "failed";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const btcAddress = searchParams.get("btcAddress");
  const list = searchParams.get("list");

  // If no query params, return self-documenting info
  if (!btcAddress && !list) {
    return NextResponse.json({
      endpoint: "/api/admin/genesis-payout",
      description: "Admin endpoint for Arc to record and query genesis payout records.",
      authentication: {
        method: "X-Admin-Key header",
        description: "Required for POST and authenticated GET operations. Matches ARC_ADMIN_API_KEY environment variable.",
      },
      methods: {
        POST: {
          description: "Record a genesis payout after sending Bitcoin to an agent.",
          authentication: "Required",
          requestBody: {
            contentType: "application/json",
            required: {
              btcAddress: {
                type: "string",
                description: "Bitcoin Native SegWit address (bc1...)",
                example: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
              },
              rewardTxid: {
                type: "string",
                description: "Bitcoin transaction ID (64-character hex)",
                example: "a1b2c3d4e5f6...",
              },
              rewardSatoshis: {
                type: "number",
                description: "Amount sent in satoshis (must be positive integer)",
                example: 10000,
              },
              paidAt: {
                type: "string",
                description: "ISO 8601 timestamp of payment",
                example: "2026-02-06T12:34:56.789Z",
              },
            },
            optional: {
              stxAddress: {
                type: "string",
                description: "Stacks mainnet address (SP...), if known",
                example: "SP000000000000000000002Q6VF78",
              },
            },
          },
          behavior: [
            "Validates all fields strictly",
            "Checks if genesis:{btcAddress} already exists (409 if yes)",
            "Writes genesis payout record to KV",
            "Looks up claim:{btcAddress} and updates status to 'rewarded' if found",
            "Returns 200 with created record",
          ],
          responses: {
            "200": "Genesis payout recorded successfully",
            "400": "Invalid request body or validation errors",
            "401": "Missing or invalid X-Admin-Key header",
            "409": "Genesis payout already recorded for this address",
            "500": "Server error",
          },
        },
        GET: {
          description: "Query genesis payout records or get usage documentation.",
          authentication: "Required for queries with parameters, not required for documentation",
          queryParameters: {
            btcAddress: {
              type: "string",
              required: false,
              description: "Query specific genesis payout by BTC address",
              example: "?btcAddress=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
            },
            list: {
              type: "string",
              required: false,
              description: "List all genesis payouts (use ?list=true)",
              example: "?list=true",
            },
          },
          responses: {
            "200": "Genesis payout record or list of records",
            "401": "Missing or invalid X-Admin-Key header (for authenticated queries)",
            "404": "Genesis payout not found for specified address",
            "500": "Server error",
          },
        },
      },
      kvStructure: {
        genesisKey: "genesis:{btcAddress}",
        claimKey: "claim:{btcAddress}",
        description: "Genesis records are stored independently but cross-reference claim records when present",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  // Query params present - require admin auth
  try {
    const authResult = await authenticateAdmin(request);
    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: authResult.error || "Authentication failed" },
        { status: 401 }
      );
    }

    // Access KV
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Handle ?btcAddress=X query
    if (btcAddress) {
      const recordData = await kv.get(`genesis:${btcAddress}`);
      if (!recordData) {
        return NextResponse.json(
          { error: `Genesis payout not found for address: ${btcAddress}` },
          { status: 404 }
        );
      }

      const record = JSON.parse(recordData) as GenesisPayoutRecord;
      return NextResponse.json({
        success: true,
        record,
      });
    }

    // Handle ?list=true query
    if (list === "true") {
      const listResult = await kv.list({ prefix: "genesis:" });
      const records: GenesisPayoutRecord[] = [];

      // Fetch all genesis records
      for (const key of listResult.keys) {
        const recordData = await kv.get(key.name);
        if (recordData) {
          try {
            records.push(JSON.parse(recordData) as GenesisPayoutRecord);
          } catch (e) {
            console.error(`Failed to parse genesis record ${key.name}:`, e);
          }
        }
      }

      return NextResponse.json({
        success: true,
        count: records.length,
        records,
        list_complete: listResult.list_complete,
      });
    }

    // Invalid query params
    return NextResponse.json(
      { error: "Invalid query parameters. Use ?btcAddress=X or ?list=true" },
      { status: 400 }
    );

  } catch (e) {
    console.error("Genesis payout GET error:", e);
    return NextResponse.json(
      { error: `Failed to query genesis payouts: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate admin
    const authResult = await authenticateAdmin(request);
    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: authResult.error || "Authentication failed" },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = validateGenesisPayoutBody(body);

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          validationErrors: validation.errors,
        },
        { status: 400 }
      );
    }

    const validatedData = validation.data!;
    const { btcAddress, rewardTxid, rewardSatoshis, paidAt, stxAddress } = validatedData;

    // Access KV
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check for existing genesis payout (idempotency)
    const existingGenesis = await kv.get(`genesis:${btcAddress}`);
    if (existingGenesis) {
      return NextResponse.json(
        { error: "Genesis payout already recorded for this address" },
        { status: 409 }
      );
    }

    // Create genesis payout record
    let claimRecordUpdated = false;

    // Look up and update matching claim record
    const existingClaimData = await kv.get(`claim:${btcAddress}`);
    if (existingClaimData) {
      try {
        const claimRecord = JSON.parse(existingClaimData) as ClaimRecord;

        // Update claim record to rewarded status
        claimRecord.status = "rewarded";
        claimRecord.rewardTxid = rewardTxid;

        await kv.put(`claim:${btcAddress}`, JSON.stringify(claimRecord));
        claimRecordUpdated = true;
      } catch (e) {
        // Log error but don't fail the genesis payout
        console.error("Failed to update claim record:", e);
      }
    }

    // Write genesis payout record
    const genesisRecord: GenesisPayoutRecord = {
      btcAddress,
      rewardTxid,
      rewardSatoshis,
      paidAt,
      stxAddress,
      claimRecordUpdated,
    };

    await kv.put(`genesis:${btcAddress}`, JSON.stringify(genesisRecord));

    return NextResponse.json({
      success: true,
      message: "Genesis payout recorded successfully",
      record: genesisRecord,
    });

  } catch (e) {
    console.error("Genesis payout error:", e);
    return NextResponse.json(
      { error: `Failed to record genesis payout: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
