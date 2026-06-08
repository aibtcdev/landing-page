import openNextWorker, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
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
// catch-up sweep) runs from a Cloudflare Cron Trigger via the `scheduled()`
// handler below — see `triggers.crons` in wrangler.jsonc and the
// orchestration in `lib/scheduler/cron-runner.ts`.
//
// This replaced the former `SchedulerDO` Durable Object. The DO's alarm
// had no independent trigger: it only stayed armed because the /leaderboard
// SSR poked it on every render, so a DO storage wipe (the v2→v3 class
// migration) with no leaderboard traffic left ALL scheduled work silently
// stopped. A Cron Trigger fires on a guaranteed schedule regardless of
// traffic. State the DO held in `ctx.storage` now lives in KV under
// `scheduler:*` keys; the competition cursor already lived in D1.

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
