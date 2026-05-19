import { STAGED_PAYMENT_TTL_SECONDS, SPONSOR_NONCE_TTL_MS } from "@/lib/inbox/constants";
import type { RelayRPC, RelaySettleOptions } from "@/lib/inbox/relay-rpc";
import type { Logger } from "@/lib/logging";
import { logPaymentEvent } from "@/lib/inbox/payment-logging";
import {
  reconcileStagedInboxPayment,
  type ReconciliationTrigger,
} from "@/lib/inbox/reconcile-staged-payment";
import {
  getStagedInboxPayment,
  storeStagedInboxPayment,
} from "@/lib/inbox/kv-helpers";

export interface InboxReconciliationQueueMessage {
  paymentId: string;
  stagedAt: string;
  attempt: number;
  source: ReconciliationTrigger;
}

const MAX_RECONCILIATION_ATTEMPTS = 10;
const RECONCILIATION_DELAYS_SECONDS = [30, 60, 120, 300, 600];
export const INBOX_RECONCILIATION_QUEUE_ROUTE = "/__queue/inbox-reconciliation";

/** Small clock-skew buffer subtracted from nonceExpiresAt before comparing (ms). */
const NONCE_EXPIRY_BUFFER_MS = 5_000;

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
  const time = new Date(stagedAt).getTime();
  // Treat unparseable dates as expired to prevent infinite retries
  if (!Number.isFinite(time)) return STAGED_PAYMENT_TTL_SECONDS;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

/**
 * Determine whether the relay's sponsor nonce for this payment has expired.
 *
 * Uses `nonceExpiresAt` from the staged record when available (preferred —
 * relay clock is authoritative).  Falls back to `stagedAt + SPONSOR_NONCE_TTL_MS`
 * for records created before Phase 5 that lack the explicit field.
 *
 * A small clock-skew buffer (NONCE_EXPIRY_BUFFER_MS) is subtracted so the
 * queue never races the relay's NonceDO reclaim alarm.
 */
function isSponsorNonceExpired(stagedAt: string, nonceExpiresAt?: string): boolean {
  const now = Date.now();
  if (nonceExpiresAt) {
    const expiryMs = new Date(nonceExpiresAt).getTime();
    if (!Number.isFinite(expiryMs)) {
      // Unparseable timestamp — fall back to derived TTL
      const derivedExpiry = new Date(stagedAt).getTime() + SPONSOR_NONCE_TTL_MS;
      return now >= derivedExpiry - NONCE_EXPIRY_BUFFER_MS;
    }
    return now >= expiryMs - NONCE_EXPIRY_BUFFER_MS;
  }
  // No stored timestamp — derive from stagedAt
  const stagedMs = new Date(stagedAt).getTime();
  if (!Number.isFinite(stagedMs)) return true; // unparseable → treat as expired
  return now >= stagedMs + SPONSOR_NONCE_TTL_MS - NONCE_EXPIRY_BUFFER_MS;
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
  /**
   * D1 binding required for finalizing confirmed payments (#760). Absence
   * surfaces as an explicit Error so the queue retries rather than silently
   * dropping the payment via the legacy KV path.
   */
  DB?: D1Database;
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

  const db = env.DB;
  if (!db) {
    throw new Error("INBOX_RECONCILIATION_QUEUE requires DB binding");
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

    // --- Sponsor-nonce TTL check (#375 Option C) ---
    // Read the staged record to check whether the relay's sponsor nonce has
    // expired.  If it has, rebroadcasting the same sponsored hex would produce
    // a ConflictingNonceInMempool error because the relay already reclaimed
    // that nonce slot.  Instead, re-call submitPayment(txHex) to obtain a
    // fresh sponsor assignment before continuing the poll cycle.
    const stagedRecord = await getStagedInboxPayment(env.VERIFIED_AGENTS, body.paymentId);

    if (stagedRecord && isSponsorNonceExpired(body.stagedAt, stagedRecord.nonceExpiresAt)) {
      if (!stagedRecord.txHex) {
        // Pre-Phase-5 record: no txHex stored — cannot re-sponsor.
        // Log a warning and ack so the payment is discarded gracefully.
        logPaymentEvent(logger, "warn", "payment.retry_decision", repoVersion, {
          route: INBOX_RECONCILIATION_QUEUE_ROUTE,
          paymentId: body.paymentId,
          status: "pending",
          action: "ack_nonce_expired_no_tx_hex",
          additionalContext: {
            attempt: body.attempt,
            stagedAgeSeconds,
            nonceExpiresAt: stagedRecord.nonceExpiresAt ?? null,
            worker_stage: "queue_consumer",
            trigger,
          },
        });
        message.ack();
        continue;
      }

      // Re-submit the original tx hex to obtain a fresh sponsor nonce.
      // Do NOT fall back to the stale hex on failure — treat submit failure
      // as a terminal condition and ack so the message is not retried.
      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: "pending",
        action: "resubmit_after_nonce_expiry",
        additionalContext: {
          attempt: body.attempt,
          stagedAgeSeconds,
          nonceExpiresAt: stagedRecord.nonceExpiresAt ?? null,
          worker_stage: "queue_consumer",
          trigger,
        },
      });

      let resubmitResult: Awaited<ReturnType<RelayRPC["submitPayment"]>>;
      try {
        const settle: RelaySettleOptions | undefined = stagedRecord.settleOptions
          ? {
              expectedRecipient: stagedRecord.settleOptions.expectedRecipient,
              minAmount: stagedRecord.settleOptions.minAmount,
              ...(stagedRecord.settleOptions.tokenType && {
                tokenType: stagedRecord.settleOptions.tokenType,
              }),
            }
          : undefined;
        resubmitResult = await rpc.submitPayment(
          stagedRecord.txHex,
          settle,
          stagedRecord.paymentIdentifier
        );
      } catch (err) {
        // Network or binding error — log and ack (do NOT rebroadcast stale hex).
        logPaymentEvent(logger, "warn", "payment.retry_decision", repoVersion, {
          route: INBOX_RECONCILIATION_QUEUE_ROUTE,
          paymentId: body.paymentId,
          status: "pending",
          action: "ack_resubmit_exception",
          additionalContext: {
            attempt: body.attempt,
            stagedAgeSeconds,
            worker_stage: "queue_consumer",
            trigger,
            error: String(err),
          },
        });
        message.ack();
        continue;
      }

      if (!resubmitResult.accepted) {
        // Relay rejected the re-submission — ack and discard.
        logPaymentEvent(logger, "warn", "payment.retry_decision", repoVersion, {
          route: INBOX_RECONCILIATION_QUEUE_ROUTE,
          paymentId: body.paymentId,
          status: "pending",
          action: "ack_resubmit_rejected",
          additionalContext: {
            attempt: body.attempt,
            stagedAgeSeconds,
            worker_stage: "queue_consumer",
            trigger,
            code: resubmitResult.code ?? null,
            error: resubmitResult.error,
          },
        });
        message.ack();
        continue;
      }

      // Re-submission succeeded: update staged record with the new paymentId
      // and a fresh nonceExpiresAt, then re-enqueue for the next poll cycle.
      //
      // Phase 5.1 (relay PRs #379/#383): prefer the relay's authoritative
      // nonceExpiresAt over LP local derivation.  When the relay version in
      // deploy does not yet emit the field, fall back to `now +
      // SPONSOR_NONCE_TTL_MS` (the legacy behavior).
      const newPaymentId = resubmitResult.paymentId;
      const newNonceExpiresAt =
        typeof resubmitResult.nonceExpiresAt === "string" && resubmitResult.nonceExpiresAt.length > 0
          ? resubmitResult.nonceExpiresAt
          : new Date(Date.now() + SPONSOR_NONCE_TTL_MS).toISOString();

      try {
        await storeStagedInboxPayment(env.VERIFIED_AGENTS, {
          ...stagedRecord,
          paymentId: newPaymentId,
          nonceExpiresAt: newNonceExpiresAt,
        });
      } catch (err) {
        // KV write failed — cannot safely continue (old paymentId is stale,
        // new paymentId is not persisted).  Log and ack to avoid orphaned state.
        logPaymentEvent(logger, "warn", "payment.retry_decision", repoVersion, {
          route: INBOX_RECONCILIATION_QUEUE_ROUTE,
          paymentId: body.paymentId,
          status: "pending",
          action: "ack_resubmit_kv_write_failed",
          additionalContext: {
            attempt: body.attempt,
            newPaymentId,
            worker_stage: "queue_consumer",
            trigger,
            error: String(err),
          },
        });
        message.ack();
        continue;
      }

      logPaymentEvent(logger, "info", "payment.retry_decision", repoVersion, {
        route: INBOX_RECONCILIATION_QUEUE_ROUTE,
        paymentId: body.paymentId,
        status: "pending",
        action: "resubmit_succeeded",
        additionalContext: {
          oldPaymentId: body.paymentId,
          newPaymentId,
          newNonceExpiresAt,
          attempt: body.attempt,
          nextAttempt: body.attempt + 1,
          queueDelaySeconds: getRetryDelaySeconds(body.attempt),
          stagedAgeSeconds,
          worker_stage: "queue_consumer",
          trigger,
        },
      });

      const nextAttempt = body.attempt + 1;
      const queueDelaySeconds = getRetryDelaySeconds(body.attempt);

      if (queue) {
        try {
          await queue.send(
            {
              paymentId: newPaymentId,
              stagedAt: body.stagedAt,
              attempt: nextAttempt,
              source: "queue_retry",
            },
            { delaySeconds: queueDelaySeconds }
          );
          message.ack();
        } catch (err) {
          logPaymentEvent(logger, "warn", "payment.queue", repoVersion, {
            route: INBOX_RECONCILIATION_QUEUE_ROUTE,
            paymentId: newPaymentId,
            status: "pending",
            action: "enqueue_failed",
            additionalContext: {
              attempt: body.attempt,
              nextAttempt,
              queueDelaySeconds,
              worker_stage: "queue_consumer",
              trigger: "queue_retry",
              error: String(err),
            },
          });
          message.retry({ delaySeconds: queueDelaySeconds });
        }
      } else {
        message.retry({ delaySeconds: queueDelaySeconds });
      }
      continue;
    }
    // --- End sponsor-nonce TTL check ---

    const reconciliation = await reconcileStagedInboxPayment({
      kv: env.VERIFIED_AGENTS,
      db,
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
