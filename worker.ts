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

  // INTENTIONALLY INERT: scheduling moved to the standalone `aibtc-scheduler`
  // Worker (wrangler.scheduler.jsonc), and this Worker's `triggers.crons` is now
  // empty — so `scheduled()` will never fire here. Kept only so the same
  // `runScheduledTasks` is reachable if a cron is ever re-attached for debugging;
  // remove it entirely once that's confirmed unnecessary.
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

    // Capture any cron failure straight to KV, independent of the LOGS RPC
    // path — the cron has been failing with an opaque "Internal Error" and the
    // dashboard shows no stack. Writing the raw error to `scheduler:last-error`
    // lets us read the exact exception with `wrangler kv key get`. The capture
    // is fully self-guarded so it can never itself crash the invocation.
    ctx.waitUntil(
      (async () => {
        try {
          await runScheduledTasks(env, logger);
        } catch (error) {
          const detail = {
            at: Date.now(),
            cron: event.cron,
            name: error instanceof Error ? error.name : undefined,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          };
          try {
            await env.VERIFIED_AGENTS.put(
              "scheduler:last-error",
              JSON.stringify(detail)
            );
          } catch {
            // KV write failed too — nothing more we can safely do here.
          }
          try {
            logger.error("scheduler.cron_failed", {
              error: detail.message,
              stack: detail.stack,
            });
          } catch {
            // Logger itself may be the failing dependency; ignore.
          }
        }
      })()
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
