import { STAGED_PAYMENT_TTL_SECONDS } from "@/lib/inbox/constants";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";
import type { Logger } from "@/lib/logging";
import { getStagedInboxPayment } from "@/lib/inbox";
import { logPaymentEvent } from "@/lib/inbox/payment-logging";
import {
  reconcileStagedInboxPayment,
  type ReconciliationTrigger,
} from "@/lib/inbox/reconcile-staged-payment";

export interface InboxReconciliationQueueMessage {
  paymentId: string;
  stagedAt: string;
  attempt: number;
  source: ReconciliationTrigger;
}

const MAX_RECONCILIATION_ATTEMPTS = 10;
const RECONCILIATION_DELAYS_SECONDS = [30, 60, 120, 300, 600];
export const INBOX_RECONCILIATION_QUEUE_ROUTE = "/__queue/inbox-reconciliation";

function isInboxReconciliationQueueMessage(
  value: unknown
): value is InboxReconciliationQueueMessage {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.paymentId === "string" &&
    typeof record.stagedAt === "string" &&
    typeof record.attempt === "number" &&
    Number.isInteger(record.attempt) &&
    record.attempt >= 0 &&
    typeof record.source === "string"
  );
}

function getRetryDelaySeconds(attempt: number): number {
  return RECONCILIATION_DELAYS_SECONDS[
    Math.min(attempt, RECONCILIATION_DELAYS_SECONDS.length - 1)
  ] as number;
}

function getStagedAgeSeconds(stagedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(stagedAt).getTime()) / 1000));
}

export async function enqueueInboxReconciliation(
  queue: Queue<InboxReconciliationQueueMessage> | undefined,
  message: InboxReconciliationQueueMessage,
  logger: Logger,
  repoVersion: string,
  route: string,
  context: { messageId?: string; workerStage: string }
): Promise<boolean> {
  logPaymentEvent(logger, "info", "payment.queue", repoVersion, {
    route,
    paymentId: message.paymentId,
    action: "enqueue_requested",
    additionalContext: {
      messageId: context.messageId ?? null,
      attempt: message.attempt,
      trigger: message.source,
      worker_stage: context.workerStage,
    },
  });

  if (!queue) {
    logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
      route,
      paymentId: message.paymentId,
      action: "enqueue_failed",
      additionalContext: {
        messageId: context.messageId ?? null,
        attempt: message.attempt,
        trigger: message.source,
        worker_stage: context.workerStage,
        reason: "queue_binding_unavailable",
      },
    });
    return false;
  }

  try {
    await queue.send(message);
    logPaymentEvent(logger, "info", "payment.queue", repoVersion, {
      route,
      paymentId: message.paymentId,
      action: "enqueue_succeeded",
      additionalContext: {
        messageId: context.messageId ?? null,
        attempt: message.attempt,
        trigger: message.source,
        worker_stage: context.workerStage,
      },
    });
    return true;
  } catch (error) {
    logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
      route,
      paymentId: message.paymentId,
      action: "enqueue_failed",
      additionalContext: {
        messageId: context.messageId ?? null,
        attempt: message.attempt,
        trigger: message.source,
        worker_stage: context.workerStage,
        error: String(error),
      },
    });
    return false;
  }
}

export interface InboxQueueProcessorEnv {
  VERIFIED_AGENTS: KVNamespace;
  X402_RELAY?: RelayRPC;
  INBOX_RECONCILIATION_QUEUE?: Queue<InboxReconciliationQueueMessage>;
}

export async function processInboxReconciliationQueue(
  batch: MessageBatch<InboxReconciliationQueueMessage>,
  env: InboxQueueProcessorEnv,
  logger: Logger,
  repoVersion: string
): Promise<void> {
  const rpc = env.X402_RELAY;
  if (!rpc) {
    throw new Error("INBOX_RECONCILIATION_QUEUE requires X402_RELAY binding");
  }

  const queue = env.INBOX_RECONCILIATION_QUEUE;

  for (const message of batch.messages) {
    const body = message.body;

    if (!isInboxReconciliationQueueMessage(body)) {
      logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: null,
        action: "ack_invalid_message",
        additionalContext: {
          queueMessageId: message.id,
          worker_stage: "queue_consumer",
          attempts: message.attempts,
        },
      });
      message.ack();
      continue;
    }

    const stagedAgeSeconds = getStagedAgeSeconds(body.stagedAt);
    const trigger = body.source === "payment_status_get" ? "queue_retry" : body.source;

    logPaymentEvent(logger, "info", "payment.queue", repoVersion, {
      route: INBOX_RECONCILIATION_QUEUE_ROUTE,
      paymentId: body.paymentId,
      action: "dequeue_received",
      additionalContext: {
        queueMessageId: message.id,
        attempt: body.attempt,
        stagedAgeSeconds,
        worker_stage: "queue_consumer",
        trigger,
      },
    });

    const staged = await getStagedInboxPayment(env.VERIFIED_AGENTS, body.paymentId);
    if (!staged) {
      logPaymentEvent(logger, "info", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        action: "ack_missing_staged_record",
        additionalContext: {
          queueMessageId: message.id,
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        action: "skip_requeue_missing_staged_record",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      message.ack();
      continue;
    }

    const reconciliation = await reconcileStagedInboxPayment({
      kv: env.VERIFIED_AGENTS,
      rpc,
      paymentId: body.paymentId,
      logger,
      route: INBOX_RECONCILIATION_QUEUE_ROUTE,
      repoVersion,
      workerStage: "queue_consumer",
      trigger,
      attempt: body.attempt,
    });

    if (reconciliation.outcome !== "retry") {
      message.ack();
      continue;
    }

    if (body.attempt >= MAX_RECONCILIATION_ATTEMPTS) {
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "skip_requeue_retry_exhausted",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "ack_retry_exhausted",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      message.ack();
      continue;
    }

    if (stagedAgeSeconds >= STAGED_PAYMENT_TTL_SECONDS) {
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "skip_requeue_age_exhausted",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "ack_age_exhausted",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });
      message.ack();
      continue;
    }

    const nextAttempt = body.attempt + 1;
    const queueDelaySeconds = getRetryDelaySeconds(body.attempt);

    logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
      route: INBOX_RECONCILIATION_QUEUE_ROUTE,
      paymentId: body.paymentId,
      status: reconciliation.result.status,
      action: "requeue_inflight_payment",
      additionalContext: {
        attempt: body.attempt,
        nextAttempt,
        queueDelaySeconds,
        stagedAgeSeconds,
        worker_stage: "queue_consumer",
        trigger: "queue_retry",
      },
    });

    if (!queue) {
      logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "enqueue_failed",
        additionalContext: {
          attempt: body.attempt,
          nextAttempt,
          queueDelaySeconds,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger: "queue_retry",
          reason: "queue_binding_unavailable",
        },
      });
      message.retry({ delaySeconds: queueDelaySeconds });
      continue;
    }

    try {
      await queue.send(
        {
          paymentId: body.paymentId,
          stagedAt: body.stagedAt,
          attempt: nextAttempt,
          source: "queue_retry",
        },
        { delaySeconds: queueDelaySeconds }
      );
      message.ack();
    } catch (error) {
      logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: reconciliation.result.status,
        action: "enqueue_failed",
        additionalContext: {
          attempt: body.attempt,
          nextAttempt,
          queueDelaySeconds,
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger: "queue_retry",
          error: String(error),
        },
      });
      message.retry({ delaySeconds: queueDelaySeconds });
    }
  }
}
