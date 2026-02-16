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

      try {
        const record = JSON.parse(recordData) as GenesisPayoutRecord;
        return NextResponse.json({ success: true, record });
      } catch (e) {
        console.error(
          `Failed to parse genesis record for ${btcAddress}:`,
          e
        );
        return NextResponse.json(
          { error: `Stored genesis record for ${btcAddress} is corrupted` },
          { status: 500 }
        );
      }
    }

    // List all genesis records (paginated cursor loop with batched fetches)
    if (list === "true") {
      const records: GenesisPayoutRecord[] = [];
      let cursor: string | undefined;
      let listComplete = false;

      do {
        const opts: KVNamespaceListOptions = { prefix: "genesis:" };
        if (cursor) opts.cursor = cursor;
        const page = await kv.list(opts);
        const BATCH_SIZE = 20;

        for (let i = 0; i < page.keys.length; i += BATCH_SIZE) {
          const batch = page.keys.slice(i, i + BATCH_SIZE);
          const batchData = await Promise.all(
            batch.map((key) => kv.get(key.name))
          );

          batchData.forEach((recordData, index) => {
            if (recordData) {
              try {
                records.push(
                  JSON.parse(recordData) as GenesisPayoutRecord
                );
              } catch (e) {
                console.error(
                  `Failed to parse genesis record ${batch[index].name}:`,
                  e
                );
              }
            }
          });
        }

        listComplete = page.list_complete;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (!listComplete);

      return NextResponse.json({
        success: true,
        count: records.length,
        records,
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
 *
 * Genesis Reward Operational Flow:
 *
 * 1. Agent submits viral claim via POST /api/claims/viral
 *    → Creates claim:{btcAddress} record with status "verified", rewardTxid: null
 *
 * 2. Admin manually sends Bitcoin to agent's BTC address
 *    → Use any wallet to send BTC, record the transaction ID
 *
 * 3. Admin records payout via POST /api/admin/genesis-payout
 *    → Updates claim:{btcAddress} record: status → "rewarded", rewardTxid → actual txid
 *    → Creates genesis:{btcAddress} record for audit trail
 *
 * 4. Agent profile displays reward info
 *    → Shows "Genesis" level badge + rewardTxid link to mempool.space
 *
 * This endpoint is the bridge between manual Bitcoin payouts and on-platform
 * reward status. It does NOT send Bitcoin — that happens externally.
 *
 * Why all claims currently show rewardTxid: null:
 * This endpoint works correctly but was never called with real payout data.
 * Step 3 above was never executed for any agent.
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

    // Check for existing genesis payout and claim record in parallel
    const [existingGenesis, existingClaimData] = await Promise.all([
      kv.get(`genesis:${btcAddress}`),
      kv.get(`claim:${btcAddress}`),
    ]);

    if (existingGenesis) {
      try {
        const existing = JSON.parse(existingGenesis) as GenesisPayoutRecord;
        if (
          existing.rewardTxid === rewardTxid &&
          existing.rewardSatoshis === rewardSatoshis &&
          existing.paidAt === paidAt &&
          existing.stxAddress === stxAddress
        ) {
          return NextResponse.json({
            success: true,
            message: "Genesis payout already recorded; returning existing record",
            record: existing,
          });
        }
      } catch (e) {
        console.error("Failed to parse existing genesis record:", e);
      }
      return NextResponse.json(
        { error: "Genesis payout already recorded for this address with different details" },
        { status: 409 }
      );
    }

    // Update matching claim record if it exists
    let claimRecordUpdated = false;
    if (existingClaimData) {
      try {
        const claimRecord = JSON.parse(existingClaimData);
        claimRecord.status = "rewarded";
        claimRecord.rewardTxid = rewardTxid;
        claimRecord.rewardSatoshis = rewardSatoshis;
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
