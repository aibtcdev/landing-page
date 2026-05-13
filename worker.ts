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
import { getActiveTokenIds } from "./lib/external/tenero";
import {
  runTeneroTask,
  type TeneroRunResult,
  TENERO_MINUTE_QUOTA_BACKOFF_MS,
} from "./lib/scheduler/tenero-task";
import {
  runCompetitionScheduler,
  type CompetitionSchedulerSummary,
} from "./lib/competition/scheduler";
import type {
  SchedulerRefreshResult,
  SchedulerStatus,
  SchedulerTask,
} from "./lib/scheduler/rpc-types";

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
// - lastTeneroRunAt        — unix millis when the Tenero task last completed
// - lastTeneroResult       — { succeeded, failed, minuteRemaining, monthRemaining }
// - lastCompetitionRunAt   — unix millis when the competition sweep last completed
// - lastCompetitionResult  — { scanned, found, inserted, alreadyKnown, pending, rejected, rejectionReasons, cursor }
// - consecutiveFailures    — { tenero: number, competition: number }
// - pausedUntil            — unix millis; alarm() is a no-op until this passes
// - nextRunAfter           — adaptive backoff per task
//
// Long-lived cursors stay in D1 per issue #768 — the DO holds only its
// own bookkeeping.

const TENERO_INTERVAL_MS = 5 * 60 * 1000;
const COMPETITION_INTERVAL_MS = 15 * 60 * 1000;
const ALARM_TICK_MS = TENERO_INTERVAL_MS;

type SchedulerFailureTask = "tenero" | "competition";

type StoredScheduler = {
  lastTeneroRunAt?: number;
  lastTeneroResult?: TeneroRunResult;
  lastCompetitionRunAt?: number;
  lastCompetitionResult?: CompetitionSchedulerSummary;
  consecutiveFailures?: Partial<Record<SchedulerFailureTask, number>>;
  pausedUntil?: number;
  nextRunAfter?: Partial<Record<SchedulerFailureTask, number>>;
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
      lastCompetitionRunAt: s.lastCompetitionRunAt ?? null,
      lastCompetitionResult: s.lastCompetitionResult ?? null,
      consecutiveFailures: {
        tenero: s.consecutiveFailures?.tenero ?? 0,
        competition: s.consecutiveFailures?.competition ?? 0,
      },
      nextRunAfter: {
        tenero: s.nextRunAfter?.tenero ?? null,
        competition: s.nextRunAfter?.competition ?? null,
      },
      nextAlarmAt,
    };
  }

  async refreshNow(task: SchedulerTask): Promise<SchedulerRefreshResult> {
    const logger = this.makeLogger({ trigger: "refreshNow", task });
    const out: SchedulerRefreshResult = {};
    if (task === "tenero" || task === "all") {
      out.tenero = await this.runTenero(logger);
    }
    if (task === "competition" || task === "all") {
      out.competition = await this.runCompetition(logger);
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

      // TODO(#768 follow-up): once balance snapshots land, this branching
      // shape becomes a copy-paste smell. Refactor to a task registry:
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

      const competitionNextRunAfter = stored.nextRunAfter?.competition ?? 0;
      const competitionDue =
        competitionNextRunAfter <= tickStartedAt &&
        (stored.lastCompetitionRunAt ?? 0) + COMPETITION_INTERVAL_MS <=
          tickStartedAt + 1_000;

      if (competitionDue) {
        try {
          await this.runCompetition(logger);
        } catch (error) {
          logger.error("scheduler.competition_unexpected_error", {
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          await this.bumpFailures("competition");
          await this.deferTask("competition", COMPETITION_INTERVAL_MS);
        }
      } else {
        logger.debug("scheduler.competition_not_due", {
          lastRunAt: stored.lastCompetitionRunAt ?? null,
          nextRunAfter: competitionNextRunAfter || null,
        });
      }
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    }
  }

  // TODO(#768 follow-up): when the balance task ships, give each task a
  // bounded slice of the tick (e.g. AbortSignal.timeout(30_000) per task)
  // so a slow Hiro response can't starve other scheduler work.
  //
  // The orchestration body is `runTeneroTask` in
  // `lib/scheduler/tenero-task.ts` — kept testable without a DO harness.
  // This wrapper only wires DO-scoped dependencies and persists the run
  // result + failure counters / backoff to DO storage.
  private async runTenero(parentLogger: Logger): Promise<TeneroRunResult> {
    const logger = parentLogger.child
      ? parentLogger.child({ task: "tenero" })
      : parentLogger;

    // Pull the active token set from the swaps table (union'd with the
    // static core; falls back to static-only on missing binding or query
    // failure). See `getActiveTokenIds` doc for the SQL + filter.
    const tokenIds = await getActiveTokenIds(this.env.DB);
    logger.info("tenero.token_set_resolved", { count: tokenIds.length });

    const { result, rateLimited, rateLimitBackoffMs } = await runTeneroTask({
      logger,
      kv: this.env.VERIFIED_AGENTS,
      tokenIds,
      apiKey: this.lookupTeneroApiKey(),
    });

    await this.persistTeneroResult(result, { rateLimited, rateLimitBackoffMs });
    return result;
  }

  private async runCompetition(parentLogger: Logger): Promise<CompetitionSchedulerSummary> {
    const logger = parentLogger.child
      ? parentLogger.child({ task: "competition" })
      : parentLogger;

    const result = await runCompetitionScheduler(
      { DB: this.env.DB, HIRO_API_KEY: this.env.HIRO_API_KEY },
      logger
    );

    await this.persistCompetitionResult(result);
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
      lastCompetitionRunAt,
      lastCompetitionResult,
      consecutiveFailures,
      pausedUntil,
      nextRunAfter,
    ] = await Promise.all([
      this.ctx.storage.get<number>("lastTeneroRunAt"),
      this.ctx.storage.get<TeneroRunResult>("lastTeneroResult"),
      this.ctx.storage.get<number>("lastCompetitionRunAt"),
      this.ctx.storage.get<CompetitionSchedulerSummary>("lastCompetitionResult"),
      this.ctx.storage.get<Partial<Record<SchedulerFailureTask, number>>>(
        "consecutiveFailures"
      ),
      this.ctx.storage.get<number>("pausedUntil"),
      this.ctx.storage.get<Partial<Record<SchedulerFailureTask, number>>>(
        "nextRunAfter"
      ),
    ]);
    return {
      ...(typeof lastTeneroRunAt === "number" ? { lastTeneroRunAt } : {}),
      ...(lastTeneroResult ? { lastTeneroResult } : {}),
      ...(typeof lastCompetitionRunAt === "number" ? { lastCompetitionRunAt } : {}),
      ...(lastCompetitionResult ? { lastCompetitionResult } : {}),
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
      const nextRunAfter = await this.readNextRunAfter();
      if (nextRunAfter.tenero) {
        delete nextRunAfter.tenero;
        await this.ctx.storage.put("nextRunAfter", nextRunAfter);
      }
    } else if (result.failed > 0 || opts.rateLimited) {
      await this.bumpFailures("tenero");
    }

    if (opts.rateLimited) {
      const nextRunAfter = await this.readNextRunAfter();
      nextRunAfter.tenero =
        Date.now() + (opts.rateLimitBackoffMs ?? TENERO_MINUTE_QUOTA_BACKOFF_MS);
      await this.ctx.storage.put("nextRunAfter", nextRunAfter);
    }
  }

  private async persistCompetitionResult(
    result: CompetitionSchedulerSummary
  ): Promise<void> {
    await this.ctx.storage.put("lastCompetitionRunAt", Date.now());
    await this.ctx.storage.put("lastCompetitionResult", result);
    await this.clearFailures("competition");
    const nextRunAfter = await this.readNextRunAfter();
    if (nextRunAfter.competition) {
      delete nextRunAfter.competition;
      await this.ctx.storage.put("nextRunAfter", nextRunAfter);
    }
  }

  private async bumpFailures(task: SchedulerFailureTask): Promise<void> {
    const cur =
      ((await this.ctx.storage.get<Partial<Record<SchedulerFailureTask, number>>>(
        "consecutiveFailures"
      )) ?? {}) as Partial<Record<SchedulerFailureTask, number>>;
    cur[task] = (cur[task] ?? 0) + 1;
    await this.ctx.storage.put("consecutiveFailures", cur);
  }

  private async clearFailures(task: SchedulerFailureTask): Promise<void> {
    const cur =
      ((await this.ctx.storage.get<Partial<Record<SchedulerFailureTask, number>>>(
        "consecutiveFailures"
      )) ?? {}) as Partial<Record<SchedulerFailureTask, number>>;
    if ((cur[task] ?? 0) === 0) return;
    cur[task] = 0;
    await this.ctx.storage.put("consecutiveFailures", cur);
  }

  private async deferTask(
    task: SchedulerFailureTask,
    delayMs: number
  ): Promise<void> {
    const nextRunAfter = await this.readNextRunAfter();
    nextRunAfter[task] = Date.now() + delayMs;
    await this.ctx.storage.put("nextRunAfter", nextRunAfter);
  }

  private async readNextRunAfter(): Promise<
    Partial<Record<SchedulerFailureTask, number>>
  > {
    return (
      (await this.ctx.storage.get<Partial<Record<SchedulerFailureTask, number>>>(
        "nextRunAfter"
      )) ?? {}
    );
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
