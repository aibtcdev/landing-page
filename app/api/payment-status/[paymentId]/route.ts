import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  getPaymentRepoVersion,
} from "@/lib/inbox/payment-logging";
import {
  getPaymentStatusHttpCode,
  reconcileStagedInboxPayment,
} from "@/lib/inbox/reconcile-staged-payment";

/**
 * GET /api/payment-status/[paymentId] — Check x402 payment settlement status.
 *
 * Proxies to the relay RPC service binding's checkPayment() method so agents
 * can poll for final confirmation of pending x402 inbox payments.
 *
 * Use this endpoint after receiving `paymentStatus: "pending"` + `paymentId`
 * in a POST /api/inbox/[address] response. Pending means the message is staged
 * locally and not yet delivered. Poll every 10–30 seconds until the status is
 * "confirmed" or a terminal failure state. When the relay includes a
 * `checkStatusUrl`, that canonical hint is returned unchanged; otherwise this
 * route falls back to its local poll URL.
 *
 * Terminal statuses:
 * - "confirmed"  — sBTC transfer settled on-chain; staged inbox delivery finalizes
 * - "failed"     — Payment failed; staged inbox delivery is discarded
 * - "replaced"   — Transaction was replaced; staged inbox delivery is discarded
 * - "not_found"  — paymentId expired or unknown to the relay; returns HTTP 404 and staged inbox delivery is discarded
 *
 * In-progress statuses (keep polling):
 * - "queued"        — Accepted by relay, awaiting broadcast
 * - "broadcasting"  — Being broadcast to the network
 * - "mempool"       — In the mempool, awaiting confirmation
 *
 * Requires the X402_RELAY RPC service binding (only available in deployed
 * Cloudflare Workers, not local dev). Returns 503 if binding is absent.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;

  // Self-document when called with no meaningful paymentId
  if (!paymentId || paymentId === "help") {
    return NextResponse.json(
      {
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
        checkStatusUrlSemantics:
          "Relay-provided checkStatusUrl is preferred when present; otherwise this route returns its local polling URL.",
        terminalStatuses: {
          confirmed: "sBTC transfer settled on-chain — staged inbox delivery finalizes",
          failed: "Payment failed — staged inbox delivery is discarded",
          replaced: "Transaction was replaced — staged inbox delivery is discarded",
          not_found: "paymentId expired or unknown to the relay — staged inbox delivery is discarded",
        },
        pendingStatuses: {
          queued: "Accepted by relay and staged locally; not yet delivered",
          broadcasting: "Being broadcast to the network; staged locally only",
          mempool: "In the mempool, awaiting confirmation; staged locally only",
        },
        relatedEndpoints: {
          sendMessage: "POST /api/inbox/[address]",
          txidRecovery: "POST /api/inbox/[address] with paymentTxid field",
        },
      },
      { status: 400 }
    );
  }

  if (!paymentId.startsWith("pay_")) {
    return NextResponse.json(
      {
        error:
          "Invalid paymentId — expected a relay payment identifier (pay_ prefix)",
        code: "INVALID_PAYMENT_ID",
      },
      { status: 400 }
    );
  }

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });
  const repoVersion = getPaymentRepoVersion(env);
  const rpc = env.X402_RELAY as RelayRPC | undefined;

  if (!rpc) {
    logger.warn("Payment status RPC binding unavailable", { paymentId });
    return NextResponse.json(
      {
        error: "Payment status checks are unavailable in this environment",
        code: "RPC_NOT_AVAILABLE",
      },
      { status: 503 }
    );
  }

  try {
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const { result } = await reconcileStagedInboxPayment({
      kv,
      rpc,
      paymentId,
      logger,
      route: request.nextUrl.pathname,
      repoVersion,
      workerStage: "http_payment_status_get",
      trigger: "payment_status_get",
    });
    return NextResponse.json(result, { status: getPaymentStatusHttpCode(result.status) });
  } catch (err) {
    const errorContext =
      err instanceof Error
        ? {
            errorName: err.name,
            errorMessage: err.message,
            errorStack: err.stack,
          }
        : {
            errorValue: err,
          };

    logger.error("Payment status check failed", {
      paymentId,
      ...errorContext,
    });
    return NextResponse.json(
      {
        error: "Failed to check payment status",
        code: "RELAY_ERROR",
      },
      { status: 500 }
    );
  }
}
