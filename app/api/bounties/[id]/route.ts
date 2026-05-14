/**
 * GET /api/bounties/[id]
 *
 * Detail endpoint. Returns the bounty record, its computed status, the first
 * page of submissions, and — when applicable — denormalized `winner` and
 * `payment` blocks so the poster sees exactly who they picked and exactly
 * what memo + recipient + amount to use for payout.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  bountyStatus,
  buildExpectedMemo,
  getBounty,
  getSubmission,
  listSubmissionsForBounty,
  SBTC_CONTRACT_MAINNET,
  type BountyPaymentHint,
  type BountyRecord,
  type BountyStatus,
  type BountySubmission,
  type BountyWinner,
} from "@/lib/bounty";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const { env } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;
  if (!db) {
    return NextResponse.json(
      { error: "transient_d1_unavailable", retry_after: 5 },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const bounty = await getBounty(db, id);
  if (!bounty) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const now = new Date();
  const status: BountyStatus = bountyStatus(bounty, now);

  const { submissions, total: submissionCount } = await listSubmissionsForBounty(
    db,
    bounty.id,
    20,
    0
  );

  // Winner block — populated whenever the bounty has acceptedAt (i.e. on
  // winner-announced, paid, and abandoned-after-accept).
  let winner: BountyWinner | undefined;
  if (bounty.acceptedSubmissionId && bounty.acceptedAt) {
    const winningSub =
      submissions.find((s) => s.id === bounty.acceptedSubmissionId) ??
      (await getSubmission(db, bounty.acceptedSubmissionId));
    if (winningSub) {
      winner = buildWinner(winningSub, bounty.acceptedAt);
    }
  }

  // Payment block — only meaningful when status is winner-announced.
  let payment: BountyPaymentHint | undefined;
  if (status === "winner-announced" && winner) {
    payment = buildPaymentHint(bounty, winner.submitterStxAddress);
  }

  return NextResponse.json(
    {
      bounty: { ...bounty, status },
      submissions,
      submissionCount,
      ...(winner && { winner }),
      ...(payment && { payment }),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
      },
    }
  );
}

function buildWinner(s: BountySubmission, acceptedAt: string): BountyWinner {
  return {
    submissionId: s.id,
    submitterBtcAddress: s.submitterBtcAddress,
    submitterStxAddress: s.submitterStxAddress,
    ...(s.contentUrl && { contentUrl: s.contentUrl }),
    message: s.message,
    acceptedAt,
  };
}

function buildPaymentHint(bounty: BountyRecord, recipientStxAddress: string): BountyPaymentHint {
  const memo = buildExpectedMemo(bounty.id);
  return {
    expectedMemo: memo.ascii,
    expectedMemoHex: memo.hex,
    recipientStxAddress,
    amountSats: bounty.rewardSats,
    sbtcContract: SBTC_CONTRACT_MAINNET,
  };
}
