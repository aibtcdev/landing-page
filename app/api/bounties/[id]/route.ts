/**
 * GET /api/bounties/[id]
 *
 * Detail endpoint. Returns the bounty record, its computed status, the first
 * page of submissions, and — when applicable — a `winners` array and a
 * `payments` array so the poster sees exactly who they picked and exactly
 * what memo + recipient + amount to use for each payout.
 *
 * For single-winner bounties: `winners` contains at most one element;
 * `payments` contains at most one hint. The legacy `winner` and `payment`
 * singular fields are also included for backward compatibility.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  bountyStatus,
  buildExpectedMemo,
  getBounty,
  getSubmission,
  getWinners,
  listSubmissionsForBounty,
  SBTC_CONTRACT_MAINNET,
  type BountyPaymentHint,
  type BountyRecord,
  type BountyStatus,
  type BountySubmission,
  type BountyWinner,
  type BountyWinnerRow,
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

  const [{ submissions, total: submissionCount }, winnerRows] = await Promise.all([
    listSubmissionsForBounty(db, bounty.id, 20, 0),
    getWinners(db, bounty.id),
  ]);

  // Build the winners[] array from bounty_winners join table + submissions.
  // Fall back to a single-winner built from legacy fields for pre-023 rows
  // that somehow missed the backfill.
  const winners: BountyWinner[] = await buildWinnersArray(db, bounty, winnerRows, submissions);

  // Payment hints — one per unpaid winner, only when status is winner-announced.
  const payments: BountyPaymentHint[] = status === "winner-announced"
    ? winners
        .filter((w) => !w.paidAt)
        .map((w) => buildPaymentHint(bounty, w.submitterStxAddress))
    : [];

  // Backward-compat singular fields (first winner / first payment hint).
  const winner = winners[0] as BountyWinner | undefined;
  const payment = payments[0] as BountyPaymentHint | undefined;

  return NextResponse.json(
    {
      bounty: { ...bounty, status },
      submissions,
      submissionCount,
      winners,
      ...(payments.length > 0 && { payments }),
      // Singular compat fields — callers should migrate to winners[] / payments[]
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

async function buildWinnersArray(
  db: Parameters<typeof getSubmission>[0],
  bounty: BountyRecord,
  winnerRows: BountyWinnerRow[],
  submissions: BountySubmission[]
): Promise<BountyWinner[]> {
  if (winnerRows.length === 0) {
    // Pre-023 fallback: synthesize from legacy bounty fields if present.
    if (bounty.acceptedSubmissionId && bounty.acceptedAt) {
      const sub =
        submissions.find((s) => s.id === bounty.acceptedSubmissionId) ??
        (await getSubmission(db, bounty.acceptedSubmissionId));
      if (sub) {
        return [buildWinner(sub, bounty.acceptedAt, bounty.paidAt, bounty.paidTxid)];
      }
    }
    return [];
  }

  // Resolve submissions for each winner row.
  const subMap = new Map(submissions.map((s) => [s.id, s]));
  const result: BountyWinner[] = [];
  for (const row of winnerRows) {
    const sub = subMap.get(row.submissionId) ?? (await getSubmission(db, row.submissionId));
    if (sub) {
      result.push(buildWinner(sub, row.acceptedAt, row.paidAt, row.paidTxid));
    }
  }
  return result;
}

function buildWinner(
  s: BountySubmission,
  acceptedAt: string,
  paidAt?: string,
  paidTxid?: string
): BountyWinner {
  return {
    submissionId: s.id,
    submitterBtcAddress: s.submitterBtcAddress,
    submitterStxAddress: s.submitterStxAddress,
    ...(s.contentUrl && { contentUrl: s.contentUrl }),
    message: s.message,
    acceptedAt,
    ...(paidAt && { paidAt }),
    ...(paidTxid && { paidTxid }),
  };
}

function buildPaymentHint(bounty: BountyRecord, recipientStxAddress: string): BountyPaymentHint {
  const memo = buildExpectedMemo(bounty.id);
  return {
    expectedMemo: memo.ascii,
    expectedMemoHex: memo.hex,
    recipientStxAddress,
    amountSats: Math.floor(bounty.rewardSats / bounty.maxWinners),
    sbtcContract: SBTC_CONTRACT_MAINNET,
  };
}
