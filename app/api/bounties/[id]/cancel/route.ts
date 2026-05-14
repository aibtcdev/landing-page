/**
 * POST /api/bounties/[id]/cancel
 *
 * Poster cancels a bounty. Allowed while no acceptance has happened (status
 * is `open` or `judging`). Once a winner is picked, the poster must follow
 * through (or let the pay-grace run out and let the status flip to abandoned).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  SIGNATURE_WINDOW_SECONDS,
  bountyStatus,
  buildCancelMessage,
  getBounty,
  isWithinSignatureWindow,
  setCancelled,
  validateCancel,
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
      ? createLogger(env.LOGS, ctx, { route: "/api/bounties/[id]/cancel", method: "POST", rayId, bountyId: id })
      : createConsoleLogger({ route: "/api/bounties/[id]/cancel", method: "POST", rayId, bountyId: id });

    const db = env.DB as D1Database | undefined;
    if (!db) {
      return NextResponse.json(
        { error: "transient_d1_unavailable", retry_after: 5 },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = validateCancel(body);
    if ("errors" in parsed && parsed.errors) {
      return NextResponse.json({ error: "validation", details: parsed.errors }, { status: 400 });
    }
    const data = parsed.data!;

    if (!isWithinSignatureWindow(data.signedAt, SIGNATURE_WINDOW_SECONDS)) {
      return NextResponse.json({ error: "stale_signature" }, { status: 400 });
    }

    const bounty = await getBounty(db, id);
    if (!bounty) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const message = buildCancelMessage({ bountyId: bounty.id, signedAt: data.signedAt });
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
          message: "Cancel must be signed by the bounty poster.",
        },
        { status: 403 }
      );
    }

    const status = bountyStatus(bounty);
    if (status !== "open" && status !== "judging") {
      return NextResponse.json(
        {
          error: "invalid_state",
          message: `Cannot cancel in status "${status}".`,
          status,
        },
        { status: 422 }
      );
    }

    const cancelledAt = new Date().toISOString();
    const ok = await setCancelled(db, bounty.id, cancelledAt);
    if (!ok) {
      return NextResponse.json(
        { error: "conflict", message: "Bounty state changed concurrently." },
        { status: 409 }
      );
    }

    logger.info("bounty.cancelled", { bountyId: bounty.id });

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
