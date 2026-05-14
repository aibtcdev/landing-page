/**
 * GET /api/bounties/[id]/submissions
 *
 * Paginated submissions for one bounty. The detail endpoint returns the
 * first page inline; this endpoint is for paging beyond that or polling.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getBounty, listSubmissionsForBounty } from "@/lib/bounty";

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const { env } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;
  if (!db) {
    return NextResponse.json(
      { error: "transient_d1_unavailable", retry_after: 5 },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const bounty = await getBounty(db, id);
  if (!bounty) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100_000);

  const { submissions, total } = await listSubmissionsForBounty(db, id, limit, offset);
  const nextOffset = offset + submissions.length < total ? offset + submissions.length : null;

  return NextResponse.json(
    {
      bountyId: id,
      submissionCount: total,
      submissions,
      limit,
      offset,
      nextOffset,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
      },
    }
  );
}
