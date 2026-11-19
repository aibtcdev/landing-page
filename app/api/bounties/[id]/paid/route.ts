/**
 * POST /api/bounties/[id]/paid
 *
 * Poster proves payment with an on-chain sBTC txid. The poster pays every
 * member of the winning submission directly (a solo entry has one member),
 * and each member's transfer is verified on its own. Verification chain:
 *   - txid not already redeemed by another bounty (cheap pre-check)
 *   - tx exists on Hiro, anchored, status=success
 *   - sBTC `transfer` contract call
 *   - sender = poster, recipient = an unpaid member, amount >= that member's share
 *   - memo = BNTY:{bountyId}  (the anti-fraud binding)
 *   - block_time in [acceptedAt - 60s, acceptedAt + PAY_GRACE_MS)
 *
 * Allowed when the bounty's derived status is `winner-announced`, or when it
 * is `abandoned` after acceptance and the verified payment tx itself landed
 * inside the pay-grace window (#1110). The canonical txid that Hiro returns is
 * what we store (not the raw input).
 *
 * One txid can pay several members (a contract call with one transfer each).
 * The bounty flips to `paid` only once no member is left unpaid; until then
 * the response's `payout.unpaid` lists who is still owed and how much.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { DEFAULT_RETRY_AFTER_SECONDS } from "@/lib/stacks-api-fetch";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  PAY_GRACE_MS,
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildPaidMessage,
  buildPayout,
  getBounty,
  isTxidRedeemed,
  isWithinSignatureWindow,
  listMembers,
  recordMemberPayments,
  reserveTxid,
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

    // Status guard — must be winner-announced, or abandoned-after-accept
    // (a poster who paid on-chain inside PAY_GRACE_MS may submit proof late).
    const status = bountyStatus(bounty);
    const isAbandonedAfterAccept =
      status === "abandoned" && Boolean(bounty.acceptedAt);
    if (status === "paid") {
      return NextResponse.json(
        {
          error: "already_paid",
          message: "This bounty is already paid: every member's payment is verified.",
          status,
        },
        { status: 409 }
      );
    }
    if (status !== "winner-announced" && !isAbandonedAfterAccept) {
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

    const submissionId = bounty.acceptedSubmissionId;
    const team = (await listMembers(db, [submissionId])).get(submissionId) ?? [];
    if (team.length === 0) {
      return NextResponse.json(
        { error: "submission_not_found", message: "Accepted submission has no members on record." },
        { status: 500 }
      );
    }
    const unpaid = team.filter((m) => !m.paidTxid);
    if (unpaid.length === 0) {
      return NextResponse.json(
        {
          error: "already_paid",
          message: "Every member of the winning submission is already paid.",
          payout: buildPayout(team),
        },
        { status: 409 }
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
      recipients: unpaid.map((m) => ({
        btcAddress: m.btcAddress,
        stxAddress: m.stxAddress,
        amountSats: m.shareSats,
      })),
      logger,
      hiroApiKey: env.HIRO_API_KEY,
      kv,
    });
    if (!verify.ok) {
      const statusCode = verify.code === "TX_NOT_CONFIRMED" ? 422 : 400;
      logger.warn("bounty.paid_verification_failed", {
        bountyId: bounty.id,
        code: verify.code,
        txid: data.txid,
      });
      if (verify.code === "RATE_LIMITED" || verify.code === "HIRO_UNREACHABLE") {
        // Retryable: Hiro could not be read, the txid has not been judged.
        const retryAfter = verify.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
        return NextResponse.json(
          {
            error: verify.code.toLowerCase(),
            message: verify.message,
            code: verify.code,
            retryAfterSeconds: retryAfter,
          },
          {
            status: verify.code === "RATE_LIMITED" ? 429 : 503,
            headers: { "Retry-After": String(retryAfter) },
          }
        );
      }
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
    const acceptedMs = bounty.acceptedAt ? Date.parse(bounty.acceptedAt) : NaN;
    const paidMs = Date.parse(paidAt);
    if (
      !Number.isNaN(acceptedMs) &&
      !Number.isNaN(paidMs) &&
      paidMs >= acceptedMs + PAY_GRACE_MS
    ) {
      logger.warn("bounty.paid_after_grace", {
        bountyId: bounty.id,
        acceptedAt: bounty.acceptedAt,
        paidAt,
        txid: data.txid,
      });
      return NextResponse.json(
        {
          error: "invalid_state",
          message: `Cannot mark paid in status "${status}". Payment landed after the pay-grace window closed.`,
          status,
        },
        { status: 422 }
      );
    }

    let recorded: { recorded: number; bountyPaid: boolean };
    try {
      recorded = await recordMemberPayments(db, {
        bountyId: bounty.id,
        submissionId,
        txid: verify.canonicalTxid,
        paidAt,
        payments: verify.matched.map((m) => ({ btcAddress: m.btcAddress, eventIndex: m.eventIndex })),
      });
    } catch (e) {
      // Unique index conflict: this transfer is already recorded, or this
      // canonical txid already completed another bounty.
      logger.warn("bounty.paid_unique_violation", {
        bountyId: bounty.id,
        canonicalTxid: verify.canonicalTxid,
        error: String(e),
      });
      return NextResponse.json(
        {
          error: "txid_already_redeemed",
          message: "This transfer is already recorded, or this txid already paid another bounty.",
        },
        { status: 409 }
      );
    }
    if (recorded.recorded === 0) {
      return NextResponse.json(
        { error: "conflict", message: "Bounty state changed concurrently. Re-fetch the bounty." },
        { status: 409 }
      );
    }

    // D1 has already committed the paid_txid — the unique partial index is
    // the durable enforcement. KV reservation is the cheap pre-check for
    // *future* /paid requests against other bounties; if it fails (KV blip),
    // log and keep going so the user doesn't see a 500 after a successful
    // payment.
    try {
      await reserveTxid(kv, verify.canonicalTxid, bounty.id);
    } catch (e) {
      logger.warn("bounty.paid_kv_reserve_failed", {
        bountyId: bounty.id,
        canonicalTxid: verify.canonicalTxid,
        error: String(e),
      });
    }

    logger.info(recorded.bountyPaid ? "bounty.paid" : "bounty.member_paid", {
      bountyId: bounty.id,
      canonicalTxid: verify.canonicalTxid,
      paidAt,
      members: verify.matched.map((m) => m.btcAddress),
    });

    const fresh = await getBounty(db, bounty.id);
    const freshTeam = (await listMembers(db, [submissionId])).get(submissionId) ?? team;
    const payout = buildPayout(freshTeam);
    return NextResponse.json({
      bounty: { ...fresh, status: bountyStatus(fresh!) },
      paidMembers: verify.matched.map((m) => ({
        btcAddress: m.btcAddress,
        stxAddress: m.stxAddress,
        amountSats: m.amount,
      })),
      payout,
      ...(verify.underpaid.length > 0 && { underpaid: verify.underpaid }),
      message:
        payout.unpaid.length === 0
          ? "Every member is paid. The bounty is paid."
          : `${payout.membersPaid} of ${payout.membersTotal} members paid. Still owed: ${payout.unpaid
              .map((u) => `${u.amountSats} sats to ${u.stxAddress}`)
              .join(", ")}. Send each with memo BNTY:${bounty.id}, then POST /paid with that txid.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: (e as Error).message },
      { status: 500 }
    );
  }
}
