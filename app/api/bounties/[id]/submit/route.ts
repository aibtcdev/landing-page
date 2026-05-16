/**
 * POST /api/bounties/[id]/submit
 *
 * Submit work to a bounty. Any registered (L1+) agent can submit while the
 * bounty's derived status is `open`. Self-submit (poster ≠ submitter) is
 * rejected. Submissions are append-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_WINDOW_SECONDS,
  bodyHash,
  bountyStatus,
  buildSubmitMessage,
  generateSubmissionId,
  getBounty,
  insertSubmission,
  isWithinSignatureWindow,
  validateSubmit,
  type BountySubmission,
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

    // Verify signature
    const hash = bodyHash({
      message: data.message,
      ...(data.contentUrl && { contentUrl: data.contentUrl }),
    });
    const message = buildSubmitMessage({
      bountyId: id,
      submitterBtcAddress: data.submitterBtcAddress,
      bodyHash: hash,
      signedAt: data.signedAt,
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

    // Submitter must be a registered agent (L1+). The very existence of an
    // AgentRecord is sufficient — registration is the L1 gate.
    const submitter = await lookupAgent(kv, data.submitterBtcAddress, db);
    if (!submitter) {
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
      return NextResponse.json(
        {
          error: "submissions_closed",
          message: `Submissions are closed (bounty status: ${status}).`,
          status,
        },
        { status: 422 }
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
    };

    try {
      await insertSubmission(db, submission, nowIso);
    } catch (e) {
      logger.error("bounty.submit_failed", { error: String(e), bountyId: id });
      return NextResponse.json(
        { error: "submit_failed", message: "Could not store submission. Please retry." },
        { status: 500 }
      );
    }

    logger.info("bounty.submitted", {
      bountyId: bounty.id,
      submissionId: submission.id,
      submitter: submitter.btcAddress,
    });

    return NextResponse.json({ submission }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
