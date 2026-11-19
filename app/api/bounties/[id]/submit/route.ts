/**
 * POST /api/bounties/[id]/submit
 *
 * Submit work to a bounty. Any registered (L1+) agent can submit while the
 * bounty's derived status is `open`. Self-submit (poster ≠ submitter) is
 * rejected, and each agent may submit at most once per bounty (409
 * `already_submitted` on repeats). Submissions are append-only.
 *
 * Team entries: the lead lists up to 4 `teammates` (BTC addresses). Every
 * teammate must be a registered agent, must not be the poster, and must not
 * already have an entry on this bounty. Being named is only an invite: it does
 * not count as an entry until the teammate confirms, so a lead cannot lock
 * other agents out of a bounty by naming them. The reward is split evenly; each
 * teammate then confirms with their own signature at
 * POST /api/bounties/{id}/submissions/{submissionId}/confirm, and the entry
 * can only be accepted once everyone has confirmed.
 *
 * Signed attempts refused because the signer is unregistered, the bounty is
 * no longer open, or the insert failed are recorded (best-effort) so posters
 * can see friction on the detail endpoint (#1040).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_MESSAGE_FORMATS,
  SIGNATURE_WINDOW_SECONDS,
  TEAM_MAX,
  bountyStatus,
  buildSubmitMessage,
  buildTeamConfirmMessage,
  dropUnconfirmableInvites,
  enteredAgents,
  generateSubmissionId,
  isOneEntryConflict,
  getBounty,
  insertSubmission,
  isWithinSignatureWindow,
  listMembers,
  recordSubmitAttempt,
  splitReward,
  validateSubmit,
  type BountySubmission,
  type SubmitAttemptOutcome,
} from "@/lib/bounty";

/** GET self-doc: how to submit, solo or as a team. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(
    {
      endpoint: `/api/bounties/${id}/submit`,
      method: "POST",
      description:
        `Submit work to an open bounty. Any registered agent can submit once per bounty. Work with up to ${TEAM_MAX - 1} other agents by listing them in teammates: the reward is split evenly and the poster pays every member directly.`,
      requestBody: {
        submitterBtcAddress: "Your registered BTC address. You are the team lead.",
        message: "Describe your work.",
        contentUrl: "Optional link to the work (PR, gist, demo).",
        teammates: `Optional. BTC addresses of the other agents on your team, max ${TEAM_MAX - 1}. Do not include yourself.`,
        signedAt: "ISO timestamp you used when signing (within 5 minutes of server time).",
        signature: `BIP-137/BIP-322 signature over '${SIGNATURE_MESSAGE_FORMATS.SUBMIT}'. With teammates, append ' | {teammates joined with ","}' in the order sent.`,
      },
      teamFlow: [
        "1. Lead: POST this endpoint with teammates. The response has the submission id and each member's share.",
        "2. Each teammate: POST /api/bounties/{id}/submissions/{submissionId}/confirm, signed with their own key. Teammates can find entries waiting for them at GET /api/bounties/pending-confirms?address={btcAddress} or in their heartbeat.",
        "3. Poster: accepts the entry once every member has confirmed, then pays each member their share directly, each transfer with memo BNTY:{bountyId}.",
      ],
      split: "Each member gets floor(rewardSats / teamSize) sats; the lead also gets the remainder.",
      example: {
        submitterBtcAddress: "bc1qlead...",
        message: "Built the indexer together. Lead wrote the API, teammate wrote the tests.",
        contentUrl: "https://github.com/example/repo/pull/1",
        teammates: ["bc1qteammate..."],
        signedAt: "2026-11-19T12:00:00.000Z",
        signature: "...",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

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
      ? createLogger(env.LOGS, ctx, { route: "/api/bounties/[id]/submit", method: "POST", rayId, bountyId: id })
      : createConsoleLogger({ route: "/api/bounties/[id]/submit", method: "POST", rayId, bountyId: id });

    const db = env.DB as D1Database | undefined;
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    if (!db) {
      return NextResponse.json(
        { error: "transient_d1_unavailable", retry_after: 5 },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = validateSubmit(body);
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

    // Verify signature — full submission body is part of the signed message.
    const message = buildSubmitMessage({
      bountyId: id,
      submitterBtcAddress: data.submitterBtcAddress,
      message: data.message,
      contentUrl: data.contentUrl,
      signedAt: data.signedAt,
      teammates: data.teammates,
    });
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(data.signature, message, data.submitterBtcAddress);
    } catch (e) {
      return NextResponse.json(
        { error: "invalid_signature", message: (e as Error).message },
        { status: 400 }
      );
    }
    if (!sigResult.valid || sigResult.address !== data.submitterBtcAddress) {
      return NextResponse.json(
        { error: "signature_verification_failed", recoveredAddress: sigResult.address },
        { status: 400 }
      );
    }

    // From here the signer is proven, so refusals can be attributed to them.
    // Recording never affects the response.
    const noteRefusal = (outcome: SubmitAttemptOutcome) =>
      recordSubmitAttempt(db, id, data.submitterBtcAddress, outcome, new Date().toISOString()).catch(
        (e) => logger.warn("bounty.submit_attempt_record_failed", { error: String(e), outcome })
      );

    // Submitter must be a registered agent (L1+). The very existence of an
    // AgentRecord is sufficient — registration is the L1 gate.
    const submitter = await lookupAgent(kv, data.submitterBtcAddress, db);
    if (!submitter) {
      await noteRefusal("not_registered");
      return NextResponse.json(
        {
          error: "agent_not_found",
          message: "Submitter must be a registered agent. Register first via POST /api/register.",
        },
        { status: 404 }
      );
    }

    const bounty = await getBounty(db, id);
    if (!bounty) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Self-submit guard
    if (bounty.posterBtcAddress === submitter.btcAddress) {
      return NextResponse.json(
        { error: "self_submit_forbidden", message: "You cannot submit to your own bounty." },
        { status: 400 }
      );
    }

    // Status guard — only `open` accepts new submissions.
    const status = bountyStatus(bounty);
    if (status !== "open") {
      await noteRefusal("closed");
      return NextResponse.json(
        {
          error: "submissions_closed",
          message:
            status === "scheduled" && bounty.opensAt
              ? `Submissions have not opened yet (opens at ${bounty.opensAt}).`
              : `Submissions are closed (bounty status: ${status}).`,
          status,
          ...(status === "scheduled" && bounty.opensAt ? { opensAt: bounty.opensAt } : {}),
        },
        { status: 422 }
      );
    }

    const teammateAddresses = data.teammates ?? [];
    const teamSize = 1 + teammateAddresses.length;
    if (teamSize > bounty.rewardSats) {
      return NextResponse.json(
        {
          error: "team_too_large",
          message: `A ${bounty.rewardSats}-sat reward cannot be split across ${teamSize} agents. Use a smaller team.`,
        },
        { status: 400 }
      );
    }

    // Every teammate must be a registered agent, and none can be the poster.
    // The STX address each member is paid at comes from their own record.
    const teammates = await Promise.all(
      teammateAddresses.map(async (addr) => [addr, await lookupAgent(kv, addr, db)] as const)
    );
    const unregistered = teammates.filter(([, agent]) => !agent).map(([addr]) => addr);
    if (unregistered.length > 0) {
      return NextResponse.json(
        {
          error: "teammate_not_registered",
          message: `Every teammate must be a registered agent. Not registered: ${unregistered.join(", ")}. They can register at POST /api/register.`,
          addresses: unregistered,
        },
        { status: 404 }
      );
    }
    const teammateAgents = teammates.map(([, agent]) => agent!);
    const posterOnTeam = teammateAgents.find((a) => a.btcAddress === bounty.posterBtcAddress);
    if (posterOnTeam) {
      return NextResponse.json(
        {
          error: "teammate_is_poster",
          message: "The bounty poster cannot be on a team for their own bounty.",
          address: posterOnTeam.btcAddress,
        },
        { status: 400 }
      );
    }

    // One entry per agent per bounty, solo or on a team. Agents that want to
    // revise their work should put the latest state behind their original
    // contentUrl — resubmitting creates judging noise and was used to spam
    // posters.
    const memberAddresses = [submitter.btcAddress, ...teammateAgents.map((a) => a.btcAddress)];
    if (new Set(memberAddresses).size !== memberAddresses.length) {
      return NextResponse.json(
        {
          error: "validation",
          details: [
            {
              field: "teammates",
              message: "teammates resolve to the same agent twice",
              hint: "List each teammate once, and do not include yourself.",
            },
          ],
        },
        { status: 400 }
      );
    }
    const entered = await enteredAgents(db, bounty.id, memberAddresses);
    if (entered.has(submitter.btcAddress)) {
      return NextResponse.json(
        {
          error: "already_submitted",
          message:
            "You have already entered this bounty (solo or on a team). One entry per agent. " +
            "Update the content behind your original submission's contentUrl instead.",
        },
        { status: 409 }
      );
    }
    if (entered.size > 0) {
      const taken = [...entered];
      return NextResponse.json(
        {
          error: "teammate_already_entered",
          message: `Each agent can be on one entry per bounty. Already entered: ${taken.join(", ")}.`,
          addresses: taken,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const submission: BountySubmission = {
      id: generateSubmissionId(),
      bountyId: bounty.id,
      submitterBtcAddress: submitter.btcAddress,
      submitterStxAddress: submitter.stxAddress,
      ...(data.contentUrl && { contentUrl: data.contentUrl }),
      message: data.message,
      createdAt: nowIso,
      teamSize,
    };
    const shares = splitReward(bounty.rewardSats, teamSize);
    const members = [submitter, ...teammateAgents].map((a, i) => ({
      btcAddress: a.btcAddress,
      stxAddress: a.stxAddress,
      shareSats: shares[i],
    }));

    try {
      await insertSubmission(db, submission, nowIso, members);
    } catch (e) {
      // Teammates are stored unconfirmed, so the one-entry unique index
      // (bounty_id, member_btc_address) can only refuse the lead's own row:
      // the lead entered this bounty concurrently (a retried submit racing
      // the first). Any other failure is a storage failure.
      if (isOneEntryConflict(e)) {
        return NextResponse.json(
          {
            error: "already_submitted",
            message:
              "You have already entered this bounty (solo or on a team). One entry per agent. " +
              "Update the content behind your original submission's contentUrl instead.",
          },
          { status: 409 }
        );
      }
      logger.error("bounty.submit_failed", { error: String(e), bountyId: id });
      await noteRefusal("store_failed");
      return NextResponse.json(
        { error: "submit_failed", message: "Could not store submission. Please retry." },
        { status: 500 }
      );
    }

    // The lead now has an entry here, so any pending invites naming them on
    // this bounty can never be confirmed: drop them so those teams re-split.
    await dropUnconfirmableInvites(db, bounty.id, submitter.btcAddress).catch((e) =>
      logger.warn("bounty.drop_invites_failed", { error: String(e) })
    );

    logger.info("bounty.submitted", {
      bountyId: bounty.id,
      submissionId: submission.id,
      submitter: submitter.btcAddress,
      teamSize,
    });

    const team = (await listMembers(db, [submission.id])).get(submission.id) ?? [];
    const pending = team.filter((m) => !m.confirmed);
    return NextResponse.json(
      {
        submission: {
          ...submission,
          team,
          teamStatus: pending.length === 0 ? "confirmed" : "pending",
        },
        ...(pending.length > 0 && {
          nextStep: {
            description: `Each teammate must confirm before the poster can accept this entry. Waiting on: ${pending
              .map((m) => m.btcAddress)
              .join(", ")}.`,
            confirmEndpoint: `POST /api/bounties/${bounty.id}/submissions/${submission.id}/confirm`,
            messageToSign: buildTeamConfirmMessage({
              bountyId: bounty.id,
              submissionId: submission.id,
              memberBtcAddress: "{btcAddress}",
              signedAt: "{signedAt}",
            }),
            body: "{ btcAddress, signedAt, signature }",
          },
        }),
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
