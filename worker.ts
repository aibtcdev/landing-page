import openNextWorker, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
import { createConsoleLogger, createLogger, isLogsRPC } from "./lib/logging";
import { getPaymentRepoVersion } from "./lib/inbox/payment-logging";
import { processInboxReconciliationQueue } from "./lib/inbox/reconciliation-queue";

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
};
