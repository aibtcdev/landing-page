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
 *
 * `engagement` shows how many agents submitted and how many signed attempts
 * were refused (unregistered, closed, store failure) without a later
 * submission, so posters can tell silence apart from friction (#1040).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  bountyStatus,
  buildExpectedMemo,
  getBounty,
  getSubmissionsByIds,
  getSubmitAttemptCounts,
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
    listSubmissionsForBounty(db, bounty.id, 20, 0, bounty.submissionCount),
    getWinners(db, bounty.id),
  ]);
  // One submission per agent, so submissionCount is also distinct submitters.
  // Omitted rather than failing the detail read if the attempts table is
  // unavailable (e.g. migration 029 not yet applied).
  const engagement = await getSubmitAttemptCounts(db, bounty.id, submissionCount).catch(
    () => undefined
  );

  // Build the winners[] array from bounty_winners join table + submissions.
  // Fall back to a single-winner built from legacy fields for pre-023 rows
  // that somehow missed the backfill.
  const winners: BountyWinner[] = await buildWinnersArray(db, bounty, winnerRows, submissions);

  // Payment hints — one per unpaid winner, only when status is winner-announced.
  const payments: BountyPaymentHint[] = status === "winner-announced"
    ? winners
        .filter((w) => !w.paidAt)
        .map((w) => buildPaymentHint(bounty, w.submissionId, w.submitterStxAddress))
    : [];

  // Backward-compat singular fields (first winner / first payment hint).
  const winner = winners[0] as BountyWinner | undefined;
  const payment = payments[0] as BountyPaymentHint | undefined;

  return NextResponse.json(
    {
      bounty: { ...bounty, status },
      submissions,
      submissionCount,
      ...(engagement && { engagement }),
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
  db: Parameters<typeof getSubmissionsByIds>[0],
  bounty: BountyRecord,
  winnerRows: BountyWinnerRow[],
  submissions: BountySubmission[]
): Promise<BountyWinner[]> {
  if (winnerRows.length === 0) {
    // Pre-023 fallback: synthesize from legacy bounty fields if present.
    if (bounty.acceptedSubmissionId && bounty.acceptedAt) {
      const cached = submissions.find((s) => s.id === bounty.acceptedSubmissionId);
      const extra = cached ? [] : await getSubmissionsByIds(db, [bounty.acceptedSubmissionId]);
      const sub = cached ?? extra[0];
      if (sub) {
        return [buildWinner(sub, bounty.acceptedAt, bounty.paidAt, bounty.paidTxid)];
      }
    }
    return [];
  }

  // Batch-fetch any winner submissions not already in the first-page cache.
  // `submissions` covers at most 20 rows; winners may have submitted later.
  const subMap = new Map(submissions.map((s) => [s.id, s]));
  const missingIds = winnerRows.map((r) => r.submissionId).filter((id) => !subMap.has(id));
  if (missingIds.length > 0) {
    const extra = await getSubmissionsByIds(db, missingIds);
    for (const s of extra) subMap.set(s.id, s);
  }

  return winnerRows
    .map((row) => {
      const sub = subMap.get(row.submissionId);
      return sub ? buildWinner(sub, row.acceptedAt, row.paidAt, row.paidTxid) : null;
    })
    .filter((w): w is BountyWinner => w !== null);
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

function buildPaymentHint(
  bounty: BountyRecord,
  submissionId: string,
  recipientStxAddress: string
): BountyPaymentHint {
  const memo = buildExpectedMemo(bounty.id);
  return {
    submissionId,
    expectedMemo: memo.ascii,
    expectedMemoHex: memo.hex,
    recipientStxAddress,
    amountSats: Math.floor(bounty.rewardSats / bounty.maxWinners),
    sbtcContract: SBTC_CONTRACT_MAINNET,
  };
}
