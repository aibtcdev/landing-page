import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { validateGenesisPayoutBody } from "@/lib/admin/validation";
import { GenesisPayoutRecord } from "@/lib/admin/types";

/**
 * GET /api/admin/genesis-payout
 *
 * Query genesis payout records. Requires admin auth for all requests.
 *   ?btcAddress=bc1...  — look up a single record
 *   ?list=true          — list all genesis records
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const { searchParams } = new URL(request.url);
    const btcAddress = searchParams.get("btcAddress");
    const list = searchParams.get("list");

    // Look up a single record by btcAddress
    if (btcAddress) {
      const recordData = await kv.get(`genesis:${btcAddress}`);
      if (!recordData) {
        return NextResponse.json(
          { error: `Genesis payout not found for address: ${btcAddress}` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        record: JSON.parse(recordData) as GenesisPayoutRecord,
      });
    }

    // List all genesis records
    if (list === "true") {
      const listResult = await kv.list({ prefix: "genesis:" });
      const records: GenesisPayoutRecord[] = [];

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

    return NextResponse.json(
      { error: "Missing query parameter. Use ?btcAddress=bc1... or ?list=true" },
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

/**
 * POST /api/admin/genesis-payout
 *
 * Record a genesis payout after sending Bitcoin to an early registered agent.
 * Validates fields, checks for duplicates, writes the genesis record,
 * and updates the matching claim record to "rewarded" status if one exists.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const validation = validateGenesisPayoutBody(body);

    if (validation.errors) {
      return NextResponse.json(
        { error: "Invalid request body", validationErrors: validation.errors },
        { status: 400 }
      );
    }

    const { btcAddress, rewardTxid, rewardSatoshis, paidAt, stxAddress } =
      validation.data;

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check for existing genesis payout (prevent duplicates)
    const existingGenesis = await kv.get(`genesis:${btcAddress}`);
    if (existingGenesis) {
      return NextResponse.json(
        { error: "Genesis payout already recorded for this address" },
        { status: 409 }
      );
    }

    // Look up and update matching claim record if it exists
    let claimRecordUpdated = false;
    const existingClaimData = await kv.get(`claim:${btcAddress}`);
    if (existingClaimData) {
      try {
        const claimRecord = JSON.parse(existingClaimData);
        claimRecord.status = "rewarded";
        claimRecord.rewardTxid = rewardTxid;
        await kv.put(`claim:${btcAddress}`, JSON.stringify(claimRecord));
        claimRecordUpdated = true;
      } catch (e) {
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
    console.error("Genesis payout POST error:", e);
    return NextResponse.json(
      { error: `Failed to record genesis payout: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
