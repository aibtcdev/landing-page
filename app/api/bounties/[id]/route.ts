/**
 * GET /api/bounties/[id]
 *
 * Detail endpoint. Returns the bounty record, its computed status, the first
 * page of submissions (each with its `team`), and, once a submission is
 * accepted, the `winner` block and `payout` progress. While the winner is
 * unpaid, `payments` lists one sBTC transfer per unpaid member (recipient,
 * amount, memo): a team is paid member by member, never through the lead.
 * `payment` is kept for a solo winner for older clients.
 *
 * `engagement` shows how many agents submitted and how many signed attempts
 * were refused (unregistered, closed, store failure) without a later
 * submission, so posters can tell silence apart from friction (#1040).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getBounty, getSubmitAttemptCounts } from "@/lib/bounty";
import { loadBountyDetail } from "@/lib/bounty/detail";

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

  const detail = await loadBountyDetail(db, bounty);
  const { status, submissions, submissionCount, submissionsNextOffset } = detail;
  // One submission per agent, so submissionCount is also distinct entries.
  // Omitted rather than failing the detail read if the attempts table is
  // unavailable (e.g. migration 029 not yet applied).
  const engagement = await getSubmitAttemptCounts(db, bounty.id, submissionCount).catch(
    () => undefined
  );

  return NextResponse.json(
    {
      bounty: { ...bounty, status },
      submissions,
      submissionCount,
      submissionsNextOffset,
      ...(engagement && { engagement }),
      ...(detail.winner && { winner: detail.winner }),
      ...(detail.payout && { payout: detail.payout }),
      ...(detail.payments && { payments: detail.payments }),
      ...(detail.payment && { payment: detail.payment }),
    },
    {
      headers: {
        // While a winner is being paid, `payments` changes after every /paid
        // call; a cached copy could show an already paid member as owed and
        // lead to a second transfer, so it is never cached then.
        "Cache-Control":
          status === "winner-announced"
            ? "private, no-store"
            : "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
      },
    }
  );
}
