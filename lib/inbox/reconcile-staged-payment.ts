import {
  paymentStateDefaultDeliveryByState,
  TerminalFailureStateSchema,
} from "@aibtc/tx-schemas/core";
import { PaymentStatusHttpResponseSchema } from "@aibtc/tx-schemas/http";
import { invalidateAgentListCache } from "@/lib/cache";
import { hasAchievement, grantAchievement } from "@/lib/achievements";
import type { Logger } from "@/lib/logging";
import {
  deleteStagedInboxPayment,
  finalizeStagedInboxPayment,
  getStagedInboxPayment,
} from "@/lib/inbox/kv-helpers";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";
import {
  logPaymentEvent,
  summarizeRelayPollPayload,
} from "@/lib/inbox/payment-logging";
import {
  collapseSubmittedStatus,
  selectCanonicalCheckStatusUrl,
} from "@/lib/inbox/payment-contract";

export type ReconciliationTrigger = "payment_status_get" | "queue_retry" | "inbox_post";
export type ReconciliationWorkerStage =
  | "http_payment_status_get"
  | "queue_consumer"
  | "http_inbox_post";
export type ReconciliationOutcome = "finalized" | "discarded" | "retry" | "noop";

export interface ReconcileStagedPaymentParams {
  kv: KVNamespace;
  rpc: RelayRPC;
  paymentId: string;
  logger: Logger;
  route: string;
  repoVersion: string;
  workerStage: ReconciliationWorkerStage;
  trigger: ReconciliationTrigger;
  attempt?: number;
}

export interface ReconcileStagedPaymentResult {
  result: {
    paymentId: string;
    status: string;
    checkStatusUrl: string;
    txid?: string;
    terminalReason?: string;
  };
  outcome: ReconciliationOutcome;
}

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

export function getPaymentStatusHttpCode(status: string): number {
  if (status === "not_found") {
    return 404;
  }

  return 200;
}

export async function reconcileStagedInboxPayment(
  params: ReconcileStagedPaymentParams
): Promise<ReconcileStagedPaymentResult> {
  const {
    kv,
    rpc,
    paymentId,
    logger,
    route,
    repoVersion,
    workerStage,
    trigger,
    attempt = 0,
  } = params;

  const rawResult = await rpc.checkPayment(paymentId);
  const rawSummary = summarizeRelayPollPayload(rawResult);
  const hasMalformedPollData =
    !rawResult ||
    typeof rawResult !== "object" ||
    typeof (rawResult as { status?: unknown }).status !== "string" ||
    typeof (rawResult as { paymentId?: unknown }).paymentId !== "string";

  if (hasMalformedPollData) {
    logPaymentEvent(logger, "warn", "payment.poll", repoVersion, {
      route,
      paymentId,
      status: "malformed",
      action: "relay_poll_payload_missing_fields",
      additionalContext: {
        ...rawSummary,
        worker_stage: workerStage,
        trigger,
        attempt,
      },
    });

    // Cannot proceed without a parseable relay response — signal retry
    if (!rawResult || typeof rawResult !== "object") {
      return {
        result: {
          paymentId,
          status: "not_found",
          checkStatusUrl: `/api/payment-status/${paymentId}`,
        },
        outcome: "retry",
      };
    }
  }

  const normalizedResult = normalizePublicPaymentStatus(
    rawResult,
    logger,
    route,
    repoVersion
  ) as Record<string, unknown>;
  const fallbackCheckStatusUrl = `/api/payment-status/${paymentId}`;
  const result = PaymentStatusHttpResponseSchema.parse({
    ...normalizedResult,
    checkStatusUrl: resolveCheckStatusUrl(normalizedResult, fallbackCheckStatusUrl),
  }) as ReconcileStagedPaymentResult["result"];

  logPaymentEvent(logger, "info", "payment.poll", repoVersion, {
    route,
    paymentId: result.paymentId,
    status: result.status,
    terminalReason: result.terminalReason ?? null,
    action: ["failed", "replaced", "not_found", "confirmed"].includes(result.status)
      ? "terminal_poll_result"
      : "continue_polling",
    checkStatusUrl: result.checkStatusUrl,
    additionalContext: {
      worker_stage: workerStage,
      trigger,
      attempt,
    },
  });

  const staged = await getStagedInboxPayment(kv, result.paymentId);
  if (!staged) {
    if (
      paymentStateDefaultDeliveryByState[
        result.status as keyof typeof paymentStateDefaultDeliveryByState
      ]
    ) {
      logPaymentEvent(logger, "warn", "payment.poll", repoVersion, {
        route,
        paymentId: result.paymentId,
        status: result.status,
        terminalReason: result.terminalReason ?? null,
        action: "confirmed_without_staged_record",
        additionalContext: {
          worker_stage: workerStage,
          trigger,
          attempt,
        },
      });
    }

    return { result, outcome: "noop" };
  }

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

    if (!finalized) {
      return { result, outcome: "noop" };
    }

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
        worker_stage: workerStage,
        trigger,
        attempt,
      },
    });

    return { result, outcome: "finalized" };
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
        worker_stage: workerStage,
        trigger,
        attempt,
      },
    });

    return { result, outcome: "discarded" };
  }

  return { result, outcome: "retry" };
}
