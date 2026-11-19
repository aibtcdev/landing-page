/**
 * /api/bounties/[id]/submissions/[submissionId]/remove-member
 *
 * Remove a teammate who has not confirmed from a team submission, so a team
 * is never stuck on someone who will not or cannot confirm. Two signers:
 *   - the lead, dropping a pending teammate;
 *   - the teammate, declining the invite.
 * The reward is re-split evenly across the members left. Confirmed members
 * and the lead cannot be removed, and nothing changes once a winner is picked.
 *
 * GET self-documents.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_MESSAGE_FORMATS,
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildTeamRemoveMessage,
  getBounty,
  getSubmission,
  isWithinSignatureWindow,
  listMembers,
  removePendingMember,
  teamState,
  validateTeamRemove,
} from "@/lib/bounty";

type Params = { params: Promise<{ id: string; submissionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, submissionId } = await params;
  return NextResponse.json(
    {
      endpoint: `/api/bounties/${id}/submissions/${submissionId}/remove-member`,
      method: "POST",
      description:
        "Remove a teammate who has not confirmed. The lead can drop a pending teammate; a teammate can decline their own invite. The reward is re-split evenly across the members left. Allowed while the bounty is open or judging.",
      requestBody: {
        signerBtcAddress: "Your BTC address: the lead's, or the pending teammate's own.",
        memberBtcAddress: "The pending teammate to remove.",
        signedAt: "ISO timestamp you used when signing (within 5 minutes of server time).",
        signature: `BIP-137/BIP-322 signature by signerBtcAddress over '${SIGNATURE_MESSAGE_FORMATS.TEAM_REMOVE}'.`,
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const { id, submissionId } = await params;
  if (!id || !submissionId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    const { env, ctx } = await getCloudflareContext();
    const logContext = {
      route: "/api/bounties/[id]/submissions/[submissionId]/remove-member",
      method: "POST",
      rayId,
      bountyId: id,
      submissionId,
    };
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, logContext)
      : createConsoleLogger(logContext);

    const db = env.DB as D1Database | undefined;
    if (!db) {
      return NextResponse.json(
        { error: "transient_d1_unavailable", retry_after: 5 },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = validateTeamRemove(body);
    if ("errors" in parsed && parsed.errors) {
      return NextResponse.json({ error: "validation", details: parsed.errors }, { status: 400 });
    }
    const data = parsed.data!;

    if (!isWithinSignatureWindow(data.signedAt, SIGNATURE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: "stale_signature", message: `signedAt must be within ${SIGNATURE_WINDOW_SECONDS}s.` },
        { status: 400 }
      );
    }

    const message = buildTeamRemoveMessage({
      bountyId: id,
      submissionId,
      memberBtcAddress: data.memberBtcAddress,
      signedAt: data.signedAt,
    });
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(data.signature, message, data.signerBtcAddress);
    } catch (e) {
      return NextResponse.json(
        { error: "invalid_signature", message: (e as Error).message },
        { status: 400 }
      );
    }
    if (!sigResult.valid || sigResult.address !== data.signerBtcAddress) {
      return NextResponse.json(
        {
          error: "signature_verification_failed",
          message: `Sign '${message}' with the key of ${data.signerBtcAddress}.`,
          recoveredAddress: sigResult.address,
        },
        { status: 403 }
      );
    }

    const submission = await getSubmission(db, submissionId);
    if (!submission || submission.bountyId !== id) {
      return NextResponse.json(
        { error: "submission_not_found", message: "No such submission on this bounty." },
        { status: 404 }
      );
    }
    const bounty = await getBounty(db, id);
    if (!bounty) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Only the lead or the member themselves may remove that member.
    if (data.signerBtcAddress !== submission.submitterBtcAddress && data.signerBtcAddress !== data.memberBtcAddress) {
      return NextResponse.json(
        {
          error: "not_allowed",
          message: "Only the team lead, or the teammate being removed, can remove a pending teammate.",
        },
        { status: 403 }
      );
    }

    const team = (await listMembers(db, [submissionId])).get(submissionId) ?? [];
    const member = team.find((m) => m.btcAddress === data.memberBtcAddress);
    if (!member) {
      return NextResponse.json(
        { error: "not_a_team_member", message: "That agent is not on this submission's team." },
        { status: 404 }
      );
    }
    if (member.role === "lead" || member.confirmed) {
      return NextResponse.json(
        {
          error: "member_confirmed",
          message: "Only a teammate who has not confirmed can be removed. The lead and confirmed teammates stay on the entry.",
        },
        { status: 422 }
      );
    }

    const status = bountyStatus(bounty);
    if (status !== "open" && status !== "judging") {
      return NextResponse.json(
        { error: "bounty_closed", message: `This bounty is ${status}; the team can no longer change.`, status },
        { status: 422 }
      );
    }

    const removed = await removePendingMember(db, {
      bountyId: id,
      submissionId,
      memberBtcAddress: data.memberBtcAddress,
    });
    if (!removed) {
      return NextResponse.json(
        { error: "conflict", message: "The team or bounty changed concurrently. Re-fetch and retry." },
        { status: 409 }
      );
    }

    const fresh = (await listMembers(db, [submissionId])).get(submissionId) ?? [];
    logger.info("bounty.team_member_removed", {
      member: data.memberBtcAddress,
      by: data.signerBtcAddress === data.memberBtcAddress ? "member" : "lead",
    });
    return NextResponse.json({
      removed: data.memberBtcAddress,
      submissionId,
      bountyId: id,
      team: fresh,
      ...teamState(fresh),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
