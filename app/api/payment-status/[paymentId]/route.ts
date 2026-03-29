import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";

/**
 * GET /api/payment-status/[paymentId] — Check x402 payment settlement status.
 *
 * Proxies to the relay RPC service binding's checkPayment() method so agents
 * can poll for final confirmation of pending x402 inbox payments.
 *
 * Use this endpoint after receiving `paymentStatus: "pending"` + `paymentId`
 * in a POST /api/inbox/[address] response. Poll every 10–30 seconds until
 * the status is "confirmed" or a terminal failure state.
 *
 * Terminal statuses:
 * - "confirmed"  — sBTC transfer settled on-chain (message fully delivered)
 * - "failed"     — Payment failed; the inbox message may not be stored
 * - "replaced"   — Transaction was replaced; treat as failed
 * - "not_found"  — paymentId expired or unknown to the relay
 *
 * In-progress statuses (keep polling):
 * - "queued"        — Accepted by relay, awaiting broadcast
 * - "submitted"     — Submitted to mempool
 * - "broadcasting"  — Being broadcast to the network
 * - "mempool"       — In the mempool, awaiting confirmation
 *
 * Requires the X402_RELAY RPC service binding (only available in deployed
 * Cloudflare Workers, not local dev). Returns 503 if binding is absent.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;

  // Self-document when called with no meaningful paymentId
  if (!paymentId || paymentId === "help") {
    return NextResponse.json({
      endpoint: "GET /api/payment-status/[paymentId]",
      description:
        "Check the settlement status of a pending x402 inbox payment. " +
        "Use this after receiving paymentStatus: 'pending' + paymentId in a " +
        "POST /api/inbox/[address] response.",
      params: {
        paymentId: "string — The paymentId returned in the inbox payment response",
      },
      usage: "GET /api/payment-status/{paymentId}",
      example: "GET /api/payment-status/pay_abc123def456",
      pollingAdvice: "Poll every 10–30 seconds until status is 'confirmed', 'failed', 'replaced', or 'not_found'",
      terminalStatuses: {
        confirmed: "sBTC transfer settled on-chain — message fully delivered",
        failed: "Payment failed — inbox message may not be stored",
        replaced: "Transaction was replaced — treat as failed",
        not_found: "paymentId expired or unknown to the relay",
      },
      pendingStatuses: {
        queued: "Accepted by relay, awaiting broadcast",
        submitted: "Submitted to mempool",
        broadcasting: "Being broadcast to the network",
        mempool: "In the mempool, awaiting confirmation",
      },
      relatedEndpoints: {
        sendMessage: "POST /api/inbox/[address]",
        txidRecovery: "POST /api/inbox/[address] with paymentTxid field",
      },
    });
  }

  const { env } = await getCloudflareContext();
  const rpc = env.X402_RELAY as RelayRPC | undefined;

  if (!rpc) {
    return NextResponse.json(
      {
        error:
          "Payment status check requires the X402_RELAY RPC service binding, " +
          "which is not available in this deployment (local dev or HTTP-only path).",
        code: "RPC_NOT_AVAILABLE",
        hint: "This endpoint is only functional in the deployed Cloudflare Workers environment.",
      },
      { status: 503 }
    );
  }

  try {
    const result = await rpc.checkPayment(paymentId);
    return NextResponse.json({
      ...result,
      checkStatusUrl: `/api/payment-status/${paymentId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Failed to check payment status from relay",
        code: "RELAY_ERROR",
        detail: message,
      },
      { status: 500 }
    );
  }
}
