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
  type Logger,
} from "./lib/logging";
import { getPaymentRepoVersion } from "./lib/inbox/payment-logging";
import { processInboxReconciliationQueue } from "./lib/inbox/reconciliation-queue";
import { STATIC_TOKEN_IDS } from "./lib/external/tenero";
import {
  runTeneroTask,
  type TeneroRunResult,
  TENERO_MINUTE_QUOTA_BACKOFF_MS,
} from "./lib/scheduler/tenero-task";

// ─────────────────────────── SchedulerDO ───────────────────────────
//
// Defined inline at the worker entry (not imported from a separate file)
// so OpenNext + wrangler's esbuild bundle includes the class body. When
// SchedulerDO was imported from `./lib/scheduler/scheduler-do`, the class
// was dropped from the deployed bundle even though it appeared in `export
// { SchedulerDO }` — workerd then refused to start with "no such actor
// class; c = SchedulerDO" and every route returned 404 with
// x-preview-user-error: true. See PR #743 build logs at 07:28Z and 07:34Z,
// and OpenNext issue #502 for the broader context on custom-DO bundling
// failures with this adapter.
//
// Storage layout (this.ctx.storage):
// - lastTeneroRunAt     — unix millis when the Tenero task last completed
// - lastTeneroResult    — { succeeded, failed, minuteRemaining, monthRemaining }
// - consecutiveFailures — { tenero: number }
// - pausedUntil         — unix millis; alarm() is a no-op until this passes
// - nextRunAfter        — { tenero?: number }; adaptive backoff per task
//
// Long-lived cursors stay in D1 per issue #768 — the DO holds only its
// own bookkeeping.

const TENERO_INTERVAL_MS = 5 * 60 * 1000;
const ALARM_TICK_MS = TENERO_INTERVAL_MS;

export interface SchedulerStatus {
  now: number;
  pausedUntil: number | null;
  lastTeneroRunAt: number | null;
  lastTeneroResult: TeneroRunResult | null;
  consecutiveFailures: { tenero: number };
  nextRunAfter: { tenero: number | null };
  nextAlarmAt: number | null;
}

type StoredScheduler = {
  lastTeneroRunAt?: number;
  lastTeneroResult?: TeneroRunResult;
  consecutiveFailures?: { tenero: number };
  pausedUntil?: number;
  nextRunAfter?: { tenero?: number };
};

export class SchedulerDO extends DurableObject<CloudflareEnv> {
  constructor(state: DurableObjectState, env: CloudflareEnv) {
    super(state, env);
    // Ensure an alarm is always armed. Idempotent — getAlarm() returns
    // null if none is set.
    this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current === null) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
      }
    });
  }

  async status(): Promise<SchedulerStatus> {
    const s = await this.readStored();
    const nextAlarmAt = await this.ctx.storage.getAlarm();
    return {
      now: Date.now(),
      pausedUntil: s.pausedUntil ?? null,
      lastTeneroRunAt: s.lastTeneroRunAt ?? null,
      lastTeneroResult: s.lastTeneroResult ?? null,
      consecutiveFailures: { tenero: s.consecutiveFailures?.tenero ?? 0 },
      nextRunAfter: { tenero: s.nextRunAfter?.tenero ?? null },
      nextAlarmAt,
    };
  }

  async refreshNow(task: "tenero" | "all"): Promise<{ tenero?: TeneroRunResult }> {
    const logger = this.makeLogger({ trigger: "refreshNow", task });
    const out: { tenero?: TeneroRunResult } = {};
    if (task === "tenero" || task === "all") {
      out.tenero = await this.runTenero(logger);
    }
    return out;
  }

  async pauseUntil(timestamp: number): Promise<void> {
    await this.ctx.storage.put("pausedUntil", timestamp);
    this.makeLogger({ trigger: "pauseUntil" }).warn("scheduler.paused", {
      pausedUntil: timestamp,
    });
  }

  async resume(): Promise<void> {
    await this.ctx.storage.delete("pausedUntil");
    this.makeLogger({ trigger: "resume" }).info("scheduler.resumed", {});
  }

  async alarm(): Promise<void> {
    const tickStartedAt = Date.now();
    const logger = this.makeLogger({ trigger: "alarm", tickStartedAt });

    try {
      const stored = await this.readStored();

      if (stored.pausedUntil && stored.pausedUntil > tickStartedAt) {
        logger.info("scheduler.alarm_skipped_paused", {
          pausedUntil: stored.pausedUntil,
        });
        return;
      }

      // TODO(#768 follow-up): once a second task lands (competition Hiro
      // sweep, then balance snapshots), this branching shape becomes a
      // copy-paste smell. Refactor to a task registry:
      //   for (const task of TASKS) if (task.isDue(stored, tickStartedAt))
      //     await task.run(logger, this.ctx);
      // Each task owns its own cadence, persist helper, and failure key.
      const teneroNextRunAfter = stored.nextRunAfter?.tenero ?? 0;
      const teneroDue =
        teneroNextRunAfter <= tickStartedAt &&
        (stored.lastTeneroRunAt ?? 0) + TENERO_INTERVAL_MS <=
          tickStartedAt + 1_000;

      if (teneroDue) {
        try {
          await this.runTenero(logger);
        } catch (error) {
          logger.error("scheduler.tenero_unexpected_error", {
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          await this.bumpFailures("tenero");
        }
      } else {
        logger.debug("scheduler.tenero_not_due", {
          lastRunAt: stored.lastTeneroRunAt ?? null,
          nextRunAfter: teneroNextRunAfter || null,
        });
      }
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    }
  }

  // TODO(#768 follow-up): when the balance task ships, give each task a
  // bounded slice of the tick (e.g. AbortSignal.timeout(30_000) per
  // task) so a slow Hiro response can't starve Tenero refresh and vice
  // versa. Today Tenero is the only task and the static token set
  // bounds it implicitly; revisit when there's contention.
  //
  // The orchestration body is `runTeneroTask` in
  // `lib/scheduler/tenero-task.ts` — kept testable without a DO harness.
  // This wrapper only wires DO-scoped dependencies and persists the run
  // result + failure counters / backoff to DO storage.
  private async runTenero(parentLogger: Logger): Promise<TeneroRunResult> {
    const logger = parentLogger.child
      ? parentLogger.child({ task: "tenero" })
      : parentLogger;

    const { result, rateLimited, rateLimitBackoffMs } = await runTeneroTask({
      logger,
      kv: this.env.VERIFIED_AGENTS,
      tokenIds: STATIC_TOKEN_IDS,
      apiKey: this.lookupTeneroApiKey(),
    });

    await this.persistTeneroResult(result, { rateLimited, rateLimitBackoffMs });
    return result;
  }

  /**
   * Read the DO's bookkeeping in a single parallel batch of targeted gets.
   * `storage.list({ prefix: "" })` scans every stored key — fine at today's
   * 5 keys, but the *point* of this DO is to grow more tasks (each with
   * its own cursors and `lastResult`), so targeted `get<T>` calls keep
   * read cost bounded by the schema, not the storage size.
   *
   * Pattern mirrors `x402-sponsor-relay/src/durable-objects/nonce-do.ts`.
   */
  private async readStored(): Promise<StoredScheduler> {
    const [
      lastTeneroRunAt,
      lastTeneroResult,
      consecutiveFailures,
      pausedUntil,
      nextRunAfter,
    ] = await Promise.all([
      this.ctx.storage.get<number>("lastTeneroRunAt"),
      this.ctx.storage.get<TeneroRunResult>("lastTeneroResult"),
      this.ctx.storage.get<{ tenero: number }>("consecutiveFailures"),
      this.ctx.storage.get<number>("pausedUntil"),
      this.ctx.storage.get<{ tenero?: number }>("nextRunAfter"),
    ]);
    return {
      ...(typeof lastTeneroRunAt === "number" ? { lastTeneroRunAt } : {}),
      ...(lastTeneroResult ? { lastTeneroResult } : {}),
      ...(consecutiveFailures ? { consecutiveFailures } : {}),
      ...(typeof pausedUntil === "number" ? { pausedUntil } : {}),
      ...(nextRunAfter ? { nextRunAfter } : {}),
    };
  }

  private async persistTeneroResult(
    result: TeneroRunResult,
    opts: { rateLimited: boolean; rateLimitBackoffMs?: number }
  ): Promise<void> {
    await this.ctx.storage.put("lastTeneroRunAt", Date.now());
    await this.ctx.storage.put("lastTeneroResult", result);

    if (result.succeeded > 0 && result.failed === 0 && !opts.rateLimited) {
      await this.clearFailures("tenero");
      const nextRunAfter = ((await this.ctx.storage.get<{ tenero?: number }>(
        "nextRunAfter"
      )) ?? {}) as { tenero?: number };
      if (nextRunAfter.tenero) {
        delete nextRunAfter.tenero;
        await this.ctx.storage.put("nextRunAfter", nextRunAfter);
      }
    } else if (result.failed > 0 || opts.rateLimited) {
      await this.bumpFailures("tenero");
    }

    if (opts.rateLimited) {
      const nextRunAfter = ((await this.ctx.storage.get<{ tenero?: number }>(
        "nextRunAfter"
      )) ?? {}) as { tenero?: number };
      nextRunAfter.tenero =
        Date.now() + (opts.rateLimitBackoffMs ?? TENERO_MINUTE_QUOTA_BACKOFF_MS);
      await this.ctx.storage.put("nextRunAfter", nextRunAfter);
    }
  }

  private async bumpFailures(task: "tenero"): Promise<void> {
    const cur = ((await this.ctx.storage.get<{ tenero: number }>(
      "consecutiveFailures"
    )) ?? { tenero: 0 }) as { tenero: number };
    cur[task] = (cur[task] ?? 0) + 1;
    await this.ctx.storage.put("consecutiveFailures", cur);
  }

  private async clearFailures(task: "tenero"): Promise<void> {
    const cur = ((await this.ctx.storage.get<{ tenero: number }>(
      "consecutiveFailures"
    )) ?? { tenero: 0 }) as { tenero: number };
    if (cur[task] === 0) return;
    cur[task] = 0;
    await this.ctx.storage.put("consecutiveFailures", cur);
  }

  private makeLogger(extra: Record<string, unknown>): Logger {
    const ctxBase = {
      path: "/__do/scheduler",
      doName: "scheduler",
      ...extra,
    };
    return isLogsRPC(this.env.LOGS)
      ? createLogger(this.env.LOGS, this.ctx, ctxBase)
      : createConsoleLogger(ctxBase);
  }

  private lookupTeneroApiKey(): string | undefined {
    const key = (this.env as unknown as { TENERO_API_KEY?: string })
      .TENERO_API_KEY;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  }
}

// ─────────────────────────── Exports ───────────────────────────

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
