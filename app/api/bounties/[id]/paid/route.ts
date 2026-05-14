/**
 * POST /api/bounties/[id]/paid
 *
 * Poster proves payment with an on-chain sBTC txid. Verification chain:
 *   - txid not already redeemed by another bounty (cheap pre-check)
 *   - tx exists on Hiro, anchored, status=success
 *   - sBTC `transfer` contract call
 *   - sender = poster, recipient = winner, amount >= rewardSats
 *   - memo = BNTY:{bountyId}  (the anti-fraud binding)
 *   - block_time > acceptedAt - 60s
 *
 * Allowed only when bounty's derived status is `winner-announced`. The
 * canonical txid that Hiro returns is what we store (not the raw input).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildPaidMessage,
  getBounty,
  getSubmission,
  isTxidRedeemed,
  isWithinSignatureWindow,
  reserveTxid,
  setPaid,
  validatePaid,
  verifyPayoutTxid,
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
      ? createLogger(env.LOGS, ctx, { route: "/api/bounties/[id]/paid", method: "POST", rayId, bountyId: id })
      : createConsoleLogger({ route: "/api/bounties/[id]/paid", method: "POST", rayId, bountyId: id });

    const db = env.DB as D1Database | undefined;
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    if (!db) {
      return NextResponse.json(
        { error: "transient_d1_unavailable", retry_after: 5 },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = validatePaid(body);
    if ("errors" in parsed && parsed.errors) {
      return NextResponse.json({ error: "validation", details: parsed.errors }, { status: 400 });
    }
    const data = parsed.data!;

    if (!isWithinSignatureWindow(data.signedAt, SIGNATURE_WINDOW_SECONDS)) {
      return NextResponse.json({ error: "stale_signature" }, { status: 400 });
    }

    const bounty = await getBounty(db, id);
    if (!bounty) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Verify signature against poster
    const message = buildPaidMessage({
      bountyId: bounty.id,
      txid: data.txid,
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
          message: "Paid must be signed by the bounty poster.",
        },
        { status: 403 }
      );
    }

    // Status guard — must be winner-announced
    const status = bountyStatus(bounty);
    if (status !== "winner-announced") {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: `Cannot mark paid in status "${status}". Accept a submission first.`,
          status,
        },
        { status: 422 }
      );
    }

    if (!bounty.acceptedSubmissionId) {
      return NextResponse.json(
        { error: "invalid_state", message: "Bounty has no accepted submission." },
        { status: 422 }
      );
    }

    const acceptedSubmission = await getSubmission(db, bounty.acceptedSubmissionId);
    if (!acceptedSubmission) {
      return NextResponse.json(
        { error: "submission_not_found", message: "Accepted submission record missing." },
        { status: 500 }
      );
    }

    // Cheap pre-check: txid not already redeemed by another bounty.
    const existingBountyId = await isTxidRedeemed(kv, data.txid);
    if (existingBountyId && existingBountyId !== bounty.id) {
      return NextResponse.json(
        {
          error: "txid_already_redeemed",
          message: "This txid has already paid another bounty.",
          existingBountyId,
        },
        { status: 409 }
      );
    }

    // On-chain verification via Hiro
    const verify = await verifyPayoutTxid({
      txid: data.txid,
      bounty,
      acceptedSubmission,
    });
    if (!verify.ok) {
      const statusCode = verify.code === "TX_NOT_CONFIRMED" ? 422 : 400;
      logger.warn("bounty.paid_verification_failed", {
        bountyId: bounty.id,
        code: verify.code,
        txid: data.txid,
      });
      return NextResponse.json(
        {
          error: verify.code.toLowerCase(),
          message: verify.message,
          code: verify.code,
        },
        { status: statusCode }
      );
    }

    // Persist — use Hiro's canonical tx_id as the stored value.
    const paidAt = verify.blockTimeIso ?? new Date().toISOString();
    let ok = false;
    try {
      ok = await setPaid(db, bounty.id, verify.canonicalTxid, paidAt);
    } catch (e) {
      // D1 unique partial index conflict — same canonical txid paid another bounty.
      logger.warn("bounty.paid_unique_violation", {
        bountyId: bounty.id,
        canonicalTxid: verify.canonicalTxid,
        error: String(e),
      });
      return NextResponse.json(
        {
          error: "txid_already_redeemed",
          message: "This canonical txid has already paid another bounty.",
        },
        { status: 409 }
      );
    }
    if (!ok) {
      return NextResponse.json(
        { error: "conflict", message: "Bounty state changed concurrently." },
        { status: 409 }
      );
    }

    await reserveTxid(kv, verify.canonicalTxid, bounty.id);

    logger.info("bounty.paid", {
      bountyId: bounty.id,
      canonicalTxid: verify.canonicalTxid,
      paidAt,
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
