import openNextWorker, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import {
  createConsoleLogger,
  createLogger,
  isLogsRPC,
} from "./lib/logging";
import { getPaymentRepoVersion } from "./lib/inbox/payment-logging";
import { processInboxReconciliationQueue } from "./lib/inbox/reconciliation-queue";
import { runScheduledTasks } from "./lib/scheduler/cron-runner";

// ─────────────────────────── Scheduler ───────────────────────────
//
// Periodic background work (Tenero price refresh + competition Hiro
// catch-up sweep) now runs from a Cloudflare Cron Trigger via the
// `scheduled()` handler below — see `triggers.crons` in wrangler.jsonc and
// the orchestration in `lib/scheduler/cron-runner.ts`.
//
// This replaces the former `SchedulerDO` driver. The DO's alarm had no
// independent trigger: it only stayed armed because the /leaderboard SSR
// poked it on every render, so a DO storage wipe (the v2→v3 class migration)
// with no leaderboard traffic left ALL scheduled work silently stopped. A
// Cron Trigger fires on a guaranteed schedule regardless of traffic. State
// the DO held in `ctx.storage` now lives in KV under `scheduler:*` keys; the
// competition cursor already lived in D1.

// SchedulerDO is RETAINED but NEUTERED. We cannot delete the class in this
// PR: a `deleted_classes` Durable Object migration is rejected on the
// versioned-upload deploy path the CI uses (Cloudflare error 10211 — DO
// migrations require a non-versioned `wrangler deploy`). Keeping the class +
// its existing binding/migration history (v1/v2/v3) means no migration is
// applied, so CI deploys cleanly. The `alarm()` below is a no-op that does
// NOT re-arm, so any alarm still armed from the DO era drains itself on its
// next fire instead of double-running alongside the cron. Nothing in the app
// pokes this DO anymore (the /leaderboard kick and admin RPC were removed),
// so it is never re-instantiated after that drain. Full teardown (a v4
// `deleted_classes` migration) can land later via a one-off non-versioned
// `wrangler deploy`.
export class SchedulerDO extends DurableObject<CloudflareEnv> {
  async alarm(): Promise<void> {
    // Intentionally empty and intentionally does NOT re-arm. Drains any
    // legacy alarm left over from the DO-driven era; scheduling is now the
    // cron trigger's job.
  }
}

// ─────────────────────────── Exports ───────────────────────────

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(
    event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ) {
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, {
          path: "/__cron/scheduler",
          cron: event.cron,
        })
      : createConsoleLogger({ path: "/__cron/scheduler", cron: event.cron });

    ctx.waitUntil(
      runScheduledTasks(env, logger).catch((error) =>
        logger.error("scheduler.cron_failed", {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
      )
    );
  },

  async queue(
    batch: MessageBatch<import("./lib/inbox/reconciliation-queue").InboxReconciliationQueueMessage>,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ) {
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, {
          path: "/__queue/inbox-reconciliation",
          queue: batch.queue,
        })
      : createConsoleLogger({
          path: "/__queue/inbox-reconciliation",
          queue: batch.queue,
        });

    await processInboxReconciliationQueue(batch, env, logger, getPaymentRepoVersion(env));
  },
};
