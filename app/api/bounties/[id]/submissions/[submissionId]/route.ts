/**
 * GET /api/bounties/[id]/submissions/[submissionId]
 *
 * Single submission permalink. Useful for sharing a specific submission
 * and for the submitter's profile page to link to their work. Includes the
 * team (confirm and payout state per member).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bountyStatus, buildPayout, getBounty, getSubmission, withTeams } from "@/lib/bounty";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; submissionId: string }> }
) {
  const { id, submissionId } = await params;
  if (!id || !submissionId) {
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

  const submission = await getSubmission(db, submissionId);
  if (!submission || submission.bountyId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bounty = await getBounty(db, id);
  if (!bounty) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [withTeam] = await withTeams(db, [submission]);
  const isWinner = bounty.acceptedSubmissionId === submission.id;
  const pending = (withTeam.team ?? []).filter((m) => !m.confirmed);
  return NextResponse.json(
    {
      submission: withTeam,
      bountyId: bounty.id,
      bountyStatus: bountyStatus(bounty),
      isWinner,
      ...(isWinner && { payout: buildPayout(withTeam.team ?? []) }),
      ...(pending.length > 0 && {
        confirmEndpoint: `POST /api/bounties/${bounty.id}/submissions/${submission.id}/confirm`,
        waitingOn: pending.map((m) => m.btcAddress),
      }),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
      },
    }
  );
}
