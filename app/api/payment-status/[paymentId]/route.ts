import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  paymentStateDefaultDeliveryByState,
  TerminalFailureStateSchema,
} from "@aibtc/tx-schemas/core";
import { PaymentStatusHttpResponseSchema } from "@aibtc/tx-schemas/http";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";
import {
  deleteStagedInboxPayment,
  finalizeStagedInboxPayment,
  getStagedInboxPayment,
} from "@/lib/inbox";
import { invalidateAgentListCache } from "@/lib/cache";
import { hasAchievement, grantAchievement } from "@/lib/achievements";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import type { Logger } from "@/lib/logging";
import {
  getPaymentRepoVersion,
  logPaymentEvent,
  summarizeRelayPollPayload,
} from "@/lib/inbox/payment-logging";
import {
  collapseSubmittedStatus,
  selectCanonicalCheckStatusUrl,
} from "@/lib/inbox/payment-contract";

function normalizePublicPaymentStatus(
  raw: unknown,
  logger: Logger,
  route: string,
  repoVersion: string
): unknown {
  return collapseSubmittedStatus(raw, ({ paymentId }) => {
    logPaymentEvent(logger, "warn", "payment.fallback_used", repoVersion, {
      route,
      paymentId,
      status: "submitted",
      action: "collapse_submitted_to_queued",
      compatShimUsed: true,
    });
  });
}

function resolveCheckStatusUrl(raw: Record<string, unknown>, fallback: string): string {
  return selectCanonicalCheckStatusUrl(
    typeof raw.checkStatusUrl === "string" ? raw.checkStatusUrl : undefined,
    fallback
  ) as string;
}

function getPaymentStatusHttpCode(status: string): number {
  if (status === "not_found") {
    return 404;
  }

  return 200;
}

async function reconcileStagedInboxPayment(
  kv: KVNamespace,
  result: {
    paymentId: string;
    status: string;
    txid?: string;
    terminalReason?: string;
  },
  logger: Logger,
  route: string,
  repoVersion: string
): Promise<void> {
  const staged = await getStagedInboxPayment(kv, result.paymentId);
  if (!staged) return;

  if (
    paymentStateDefaultDeliveryByState[
      result.status as keyof typeof paymentStateDefaultDeliveryByState
    ]
  ) {
    const finalized = await finalizeStagedInboxPayment(kv, result.paymentId, {
      paymentStatus: "confirmed",
      paymentTxid: result.txid ?? staged.message.paymentTxid,
      paymentId: result.paymentId,
    });

    if (!finalized) return;

    await invalidateAgentListCache(kv);

    try {
      const hasReceiver = await hasAchievement(kv, finalized.toBtcAddress, "receiver");
      if (!hasReceiver) {
        await grantAchievement(kv, finalized.toBtcAddress, "receiver", {
          messageId: finalized.messageId,
        });
      }
    } catch (error) {
      logger.warn("Failed to grant receiver achievement after payment confirmation", {
        paymentId: result.paymentId,
        error: String(error),
      });
    }

    await grantAchievement(kv, finalized.toBtcAddress, "x402-earner", {
      messageId: finalized.messageId,
      paymentTxid: finalized.paymentTxid,
    }).catch((error) =>
      logger.warn("Failed to grant x402-earner achievement after payment confirmation", {
        paymentId: result.paymentId,
        error: String(error),
      })
    );

    logPaymentEvent(logger, "info", "payment.delivery_confirmed", repoVersion, {
      route,
      paymentId: result.paymentId,
      status: result.status,
      terminalReason: result.terminalReason ?? null,
      action: "finalize_staged_delivery",
      additionalContext: {
        messageId: finalized.messageId,
        paymentTxid: finalized.paymentTxid,
      },
    });
    return;
  }

  if (TerminalFailureStateSchema.safeParse(result.status).success) {
    await deleteStagedInboxPayment(kv, result.paymentId);
    logPaymentEvent(logger, "info", "payment.delivery_discarded", repoVersion, {
      route,
      paymentId: result.paymentId,
      status: result.status,
      terminalReason: result.terminalReason ?? null,
      action: "discard_staged_delivery",
      additionalContext: {
        messageId: staged.message.messageId,
      },
    });
  }
}

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
  const repoVersion = getPaymentRepoVersion(env as unknown as Record<string, unknown>);
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
    const rawResult = await rpc.checkPayment(paymentId);
    const rawSummary = summarizeRelayPollPayload(rawResult);
    const hasMalformedPollData =
      !rawResult ||
      typeof rawResult !== "object" ||
      typeof (rawResult as { status?: unknown }).status !== "string" ||
      typeof (rawResult as { paymentId?: unknown }).paymentId !== "string";

    if (hasMalformedPollData) {
      logPaymentEvent(logger, "warn", "payment.poll", repoVersion, {
        route: request.nextUrl.pathname,
        paymentId,
        status: "malformed",
        action: "relay_poll_payload_missing_fields",
        additionalContext: rawSummary,
      });
    }

    const normalizedResult = normalizePublicPaymentStatus(
      rawResult,
      logger,
      request.nextUrl.pathname,
      repoVersion
    ) as Record<string, unknown>;
    const fallbackCheckStatusUrl = `/api/payment-status/${paymentId}`;
    const result = PaymentStatusHttpResponseSchema.parse({
      ...normalizedResult,
      checkStatusUrl: resolveCheckStatusUrl(normalizedResult, fallbackCheckStatusUrl),
    });

    logPaymentEvent(logger, "info", "payment.poll", repoVersion, {
      route: request.nextUrl.pathname,
      paymentId: result.paymentId,
      status: result.status,
      terminalReason: result.terminalReason ?? null,
      action: ["failed", "replaced", "not_found", "confirmed"].includes(result.status)
        ? "terminal_poll_result"
        : "continue_polling",
      checkStatusUrl: result.checkStatusUrl,
    });

    await reconcileStagedInboxPayment(
      kv,
      result,
      logger,
      request.nextUrl.pathname,
      repoVersion
    );

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
