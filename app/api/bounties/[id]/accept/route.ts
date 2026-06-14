/**
 * POST /api/bounties/[id]/accept
 *
 * Poster picks a winning submission. Allowed when the bounty's derived status
 * is `open` (accepting early), `judging` (window closed, no winners yet), or
 * `partially-filled` (some slots taken, more remain — multi-winner only).
 *
 * For multi-winner bounties, this endpoint may be called up to `maxWinners`
 * times (once per winner). Each call requires a fresh signature over the chosen
 * `submissionId`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildAcceptMessage,
  getBounty,
  getSubmission,
  isWithinSignatureWindow,
  insertWinner,
  validateAccept,
} from "@/lib/bounty";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    const { env, ctx } = await getCloudflareContext();
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, { route: "/api/bounties/[id]/accept", method: "POST", rayId, bountyId: id })
      : createConsoleLogger({ route: "/api/bounties/[id]/accept", method: "POST", rayId, bountyId: id });

    const db = env.DB as D1Database | undefined;
    if (!db) {
      return NextResponse.json(
        { error: "transient_d1_unavailable", retry_after: 5 },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = validateAccept(body);
    if ("errors" in parsed && parsed.errors) {
      return NextResponse.json({ error: "validation", details: parsed.errors }, { status: 400 });
    }
    const data = parsed.data!;

    if (!isWithinSignatureWindow(data.signedAt, SIGNATURE_WINDOW_SECONDS)) {
      return NextResponse.json({ error: "stale_signature" }, { status: 400 });
    }

    const bounty = await getBounty(db, id);
    if (!bounty) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Verify signature against the bounty's poster
    const message = buildAcceptMessage({
      bountyId: bounty.id,
      submissionId: data.submissionId,
      signedAt: data.signedAt,
    });
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(data.signature, message, bounty.posterBtcAddress);
    } catch (e) {
      return NextResponse.json(
        { error: "invalid_signature", message: (e as Error).message },
        { status: 400 }
      );
    }
    if (!sigResult.valid || sigResult.address !== bounty.posterBtcAddress) {
      return NextResponse.json(
        {
          error: "signature_verification_failed",
          message: "Accept must be signed by the bounty poster.",
          recoveredAddress: sigResult.address,
        },
        { status: 403 }
      );
    }

    // Status guard — accepting is allowed from open, judging, or partially-filled
    const status = bountyStatus(bounty);
    if (status !== "open" && status !== "judging" && status !== "partially-filled") {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: `Cannot accept in status "${status}". Acceptance requires open, judging, or partially-filled status.`,
          status,
          winnerCount: bounty.winnerCount,
          maxWinners: bounty.maxWinners,
        },
        { status: 422 }
      );
    }

    // Submission must belong to this bounty
    const submission = await getSubmission(db, data.submissionId);
    if (!submission || submission.bountyId !== bounty.id) {
      return NextResponse.json(
        { error: "submission_not_found", message: "Submission does not belong to this bounty." },
        { status: 404 }
      );
    }

    const acceptedAt = new Date().toISOString();
    const result = await insertWinner(db, bounty.id, submission.id, acceptedAt);
    if (result === "duplicate") {
      return NextResponse.json(
        {
          error: "already_a_winner",
          message: "This submission has already been accepted as a winner.",
        },
        { status: 409 }
      );
    }
    if (result === "conflict") {
      // All slots filled or bounty state changed concurrently.
      return NextResponse.json(
        {
          error: "conflict",
          message: "No winner slots available. The bounty may be full or its state changed concurrently.",
          winnerCount: bounty.winnerCount,
          maxWinners: bounty.maxWinners,
        },
        { status: 409 }
      );
    }

    logger.info("bounty.accepted", {
      bountyId: bounty.id,
      submissionId: submission.id,
      winner: submission.submitterBtcAddress,
      winnerCount: bounty.winnerCount + 1,
      maxWinners: bounty.maxWinners,
    });

    const fresh = await getBounty(db, bounty.id);
    return NextResponse.json({
      bounty: { ...fresh, status: bountyStatus(fresh!) },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
