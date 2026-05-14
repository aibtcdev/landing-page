/**
 * GET /api/bounties/[id]/submissions/[submissionId]
 *
 * Single submission permalink. Useful for sharing a specific submission
 * and for the submitter's profile page to link to their work.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bountyStatus, getBounty, getSubmission } from "@/lib/bounty";

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

  return NextResponse.json(
    {
      submission,
      bountyId: bounty.id,
      bountyStatus: bountyStatus(bounty),
      isWinner: bounty.acceptedSubmissionId === submission.id,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
      },
    }
  );
}
