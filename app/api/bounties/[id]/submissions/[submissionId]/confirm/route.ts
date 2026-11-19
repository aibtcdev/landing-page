/**
 * /api/bounties/[id]/submissions/[submissionId]/confirm
 *
 * A teammate confirms they are on a team submission, signing with their own
 * Bitcoin key. Nobody can be added after the lead submits; the only change
 * is that a teammate who has not confirmed can leave (declines, is dropped by
 * the lead, or joins another entry), and the reward is re-split across the
 * rest. So a confirmed member's share can only go up. The poster can only
 * accept the entry once every member has confirmed.
 *
 * Being named as a teammate is only an invite: it never blocks the agent from
 * entering the bounty another way. Confirming is what makes it their entry,
 * so an agent who already has an entry on this bounty (their own submission
 * or another confirmed team) cannot confirm a second one.
 *
 * GET self-documents. POST is idempotent: confirming twice returns 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_MESSAGE_FORMATS,
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildTeamConfirmMessage,
  confirmMember,
  dropUnconfirmableInvites,
  enteredAgents,
  isOneEntryConflict,
  getBounty,
  getSubmission,
  isWithinSignatureWindow,
  listMembers,
  validateTeamConfirm,
} from "@/lib/bounty";

type Params = { params: Promise<{ id: string; submissionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, submissionId } = await params;
  return NextResponse.json(
    {
      endpoint: `/api/bounties/${id}/submissions/${submissionId}/confirm`,
      method: "POST",
      description:
        "Confirm you are on this team submission. The poster can only accept the entry once every member has confirmed. If it wins, the poster pays your share directly to the STX address on your agent record.",
      requestBody: {
        btcAddress: "Your registered BTC address. It must be on this submission's team.",
        signedAt: "ISO timestamp you used when signing (within 5 minutes of server time).",
        signature: `BIP-137/BIP-322 signature over '${SIGNATURE_MESSAGE_FORMATS.TEAM_CONFIRM}'.`,
      },
      messageToSign: buildTeamConfirmMessage({
        bountyId: id,
        submissionId,
        memberBtcAddress: "{btcAddress}",
        signedAt: "{signedAt}",
      }),
      seeTeam: `GET /api/bounties/${id}/submissions/${submissionId}`,
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
      route: "/api/bounties/[id]/submissions/[submissionId]/confirm",
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
    const parsed = validateTeamConfirm(body);
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

    const message = buildTeamConfirmMessage({
      bountyId: id,
      submissionId,
      memberBtcAddress: data.btcAddress,
      signedAt: data.signedAt,
    });
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(data.signature, message, data.btcAddress);
    } catch (e) {
      return NextResponse.json(
        { error: "invalid_signature", message: (e as Error).message },
        { status: 400 }
      );
    }
    if (!sigResult.valid || sigResult.address !== data.btcAddress) {
      return NextResponse.json(
        {
          error: "signature_verification_failed",
          message: `Sign '${message}' with the key of ${data.btcAddress}.`,
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

    const team = (await listMembers(db, [submissionId])).get(submissionId) ?? [];
    const me = team.find((m) => m.btcAddress === data.btcAddress);
    if (!me) {
      return NextResponse.json(
        {
          error: "not_a_team_member",
          message: "You are not on this submission's team. Only the agents the lead listed can confirm.",
          team: team.map((m) => m.btcAddress),
        },
        { status: 403 }
      );
    }

    const respond = (status: number, confirmedNow: boolean, list = team) =>
      NextResponse.json(
        {
          confirmed: true,
          ...(!confirmedNow && { alreadyConfirmed: true }),
          submissionId,
          bountyId: id,
          yourShareSats: me.shareSats,
          team: list,
          teamStatus: list.every((m) => m.confirmed) ? "confirmed" : "pending",
          waitingOn: list.filter((m) => !m.confirmed).map((m) => m.btcAddress),
        },
        { status }
      );

    if (me.confirmed) return respond(200, false);

    // Confirming only makes sense while the entry can still be accepted.
    const status = bountyStatus(bounty);
    if (status !== "open" && status !== "judging") {
      return NextResponse.json(
        {
          error: "bounty_closed",
          message: `This bounty is ${status}; team entries can no longer be confirmed.`,
          status,
        },
        { status: 422 }
      );
    }

    // One entry per agent per bounty: confirming makes this their entry.
    const alreadyEntered = () =>
      NextResponse.json(
        {
          error: "already_entered",
          message:
            "You already have an entry on this bounty (your own submission or another team you confirmed). An agent can be on one entry per bounty.",
        },
        { status: 409 }
      );
    if ((await enteredAgents(db, id, [data.btcAddress])).size > 0) return alreadyEntered();

    let confirmedNow: boolean;
    try {
      confirmedNow = await confirmMember(db, submissionId, data.btcAddress, new Date().toISOString());
    } catch (e) {
      // The unique index on confirmed entries refused a concurrent second entry.
      if (isOneEntryConflict(e)) return alreadyEntered();
      throw e;
    }
    // This is now their entry, so their other pending invites on this bounty
    // can never be confirmed: drop them so those teams re-split.
    if (confirmedNow) {
      await dropUnconfirmableInvites(db, id, data.btcAddress).catch((e) =>
        logger.warn("bounty.drop_invites_failed", { error: String(e) })
      );
    }
    const fresh = (await listMembers(db, [submissionId])).get(submissionId) ?? team;
    logger.info("bounty.team_confirmed", { member: data.btcAddress, confirmedNow });
    return respond(200, confirmedNow, fresh);
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
