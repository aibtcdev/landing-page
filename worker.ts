import openNextWorker, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
import { createConsoleLogger, createLogger, isLogsRPC } from "./lib/logging";
import { getPaymentRepoVersion } from "./lib/inbox/payment-logging";
import { processInboxReconciliationQueue } from "./lib/inbox/reconciliation-queue";
import {
  buildLeaderboardSnapshot,
  writeLeaderboardSnapshot,
} from "./lib/competition/leaderboard";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return openNextWorker.fetch(request, env, ctx);
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

  // Cron-trigger entrypoint. Wrangler's triggers.crons block (see wrangler.jsonc)
  // fires this handler on schedule; the runtime invokes it directly with no
  // HTTP path, so the `X-Cron-Secret` gate on /api/competition/leaderboard/
  // refresh isn't needed here. Cron handlers run independently of the request
  // path and have their own time budget (separate from the fetch budget).
  //
  // Dispatch is currently single-purpose (leaderboard snapshot rebuild) since
  // we only have one cron schedule. When a second schedule is added, branch
  // on `event.cron` (the schedule string) to route to the right job.
  async scheduled(
    event: ScheduledEvent,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ) {
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, {
          path: "/__scheduled/leaderboard-refresh",
          cron: event.cron,
        })
      : createConsoleLogger({
          path: "/__scheduled/leaderboard-refresh",
          cron: event.cron,
        });

    if (!env.DB) {
      logger.warn("scheduled.leaderboard_refresh.skipped_no_d1");
      return;
    }

    try {
      const snapshot = await buildLeaderboardSnapshot(
        { DB: env.DB, VERIFIED_AGENTS: env.VERIFIED_AGENTS },
        logger
      );
      await writeLeaderboardSnapshot(env.VERIFIED_AGENTS, snapshot, logger);
      logger.info("scheduled.leaderboard_refresh.ok", {
        total_agents: snapshot.stats.total_agents,
        total_swaps: snapshot.stats.total_swaps,
        priced: snapshot.stats.priced_swap_count,
        unpriced: snapshot.stats.unpriced_swap_count,
      });
    } catch (err) {
      // Failures leave the previous snapshot intact (KV TTL gives 4 ticks of
      // slack). We swallow here so one bad tick doesn't fail the cron-trigger
      // health check; the error is captured in worker-logs.
      logger.error("scheduled.leaderboard_refresh.failed", {
        error: String(err),
      });
    }
  },
};
