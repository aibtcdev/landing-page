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
// The former `SchedulerDO` Durable Object (and the neutered bridge class
// that followed it) is now fully removed via the `v4 deleted_classes`
// migration in wrangler.jsonc. NOTE: a DO migration only applies on the
// non-versioned deploy path (`wrangler deploy`), which is what the production
// (main) Cloudflare Workers Build runs — so this lands automatically on merge
// to main. The per-PR preview build (`wrangler versions upload`) rejects DO
// migrations (error 10211), so this branch's preview check will show red;
// that is expected and does not affect the production deploy.

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
