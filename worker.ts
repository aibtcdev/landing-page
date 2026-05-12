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
import { fetchTokenPriceUsd } from "./lib/external/tenero";
import { setCachedTokenPrice } from "./lib/external/tenero/kv-cache";

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
const MAX_TOKENS_PER_TICK = 30;
const TENERO_RATELIMIT_BACKOFF_MS = 5 * 60 * 1000;

const STATIC_TOKEN_IDS: readonly string[] = [
  "stx",
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc",
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx",
];

export interface SchedulerStatus {
  now: number;
  pausedUntil: number | null;
  lastTeneroRunAt: number | null;
  lastTeneroResult: TeneroRunResult | null;
  consecutiveFailures: { tenero: number };
  nextRunAfter: { tenero: number | null };
  nextAlarmAt: number | null;
}

export interface TeneroRunResult {
  startedAt: number;
  durationMs: number;
  tokensAttempted: number;
  succeeded: number;
  failed: number;
  minuteRemaining: number | null;
  monthRemaining: number | null;
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

  private async runTenero(parentLogger: Logger): Promise<TeneroRunResult> {
    const startedAt = Date.now();
    const logger = parentLogger.child
      ? parentLogger.child({ task: "tenero" })
      : parentLogger;

    let tokenIds: string[];
    try {
      tokenIds = await this.resolveActiveTokenSet();
    } catch (error) {
      logger.error("tenero.resolve_token_set_failed", { error: String(error) });
      await this.bumpFailures("tenero");
      const result: TeneroRunResult = {
        startedAt,
        durationMs: Date.now() - startedAt,
        tokensAttempted: 0,
        succeeded: 0,
        failed: 0,
        minuteRemaining: null,
        monthRemaining: null,
      };
      await this.persistTeneroResult(result, { rateLimited: false });
      return result;
    }

    logger.info("tenero.refresh_started", { tokenCount: tokenIds.length });

    const apiKey = this.lookupTeneroApiKey();
    const kv = this.env.VERIFIED_AGENTS;

    let succeeded = 0;
    let failed = 0;
    let lastMinuteRemaining: number | null = null;
    let lastMonthRemaining: number | null = null;
    let rateLimited = false;

    for (const tokenId of tokenIds) {
      const r = await fetchTokenPriceUsd(tokenId, logger, apiKey);
      lastMinuteRemaining = r.rateLimit.minuteRemaining ?? lastMinuteRemaining;
      lastMonthRemaining = r.rateLimit.monthRemaining ?? lastMonthRemaining;

      if (r.status === 0 || r.status >= 500) {
        failed++;
      } else if (r.status === 429) {
        failed++;
        rateLimited = true;
      } else if (r.status === 200) {
        try {
          await setCachedTokenPrice(kv, tokenId, {
            priceUsd: r.priceUsd,
            fetchedAt: Date.now(),
            minuteRemaining: r.rateLimit.minuteRemaining,
            monthRemaining: r.rateLimit.monthRemaining,
          });
          succeeded++;
        } catch (error) {
          logger.warn("tenero.kv_write_failed", {
            tokenId,
            error: String(error),
          });
          failed++;
        }
      } else {
        failed++;
      }

      if (
        r.rateLimit.minuteRemaining !== null &&
        r.rateLimit.minuteRemaining <= 0
      ) {
        rateLimited = true;
        logger.warn("tenero.minute_quota_exhausted_mid_run", {
          rlMinuteRemaining: r.rateLimit.minuteRemaining,
          processed: succeeded + failed,
          remaining: tokenIds.length - (succeeded + failed),
        });
        break;
      }
    }

    const result: TeneroRunResult = {
      startedAt,
      durationMs: Date.now() - startedAt,
      tokensAttempted: tokenIds.length,
      succeeded,
      failed,
      minuteRemaining: lastMinuteRemaining,
      monthRemaining: lastMonthRemaining,
    };

    await this.persistTeneroResult(result, { rateLimited });

    logger.info("tenero.refresh_completed", {
      succeeded,
      failed,
      durationMs: result.durationMs,
      rlMinuteRemaining: lastMinuteRemaining,
      rlMonthRemaining: lastMonthRemaining,
      rateLimited,
    });

    return result;
  }

  private async resolveActiveTokenSet(): Promise<string[]> {
    const set = new Set<string>(STATIC_TOKEN_IDS);
    const db = this.env.DB;
    if (db) {
      const rows = await db
        .prepare(
          `SELECT DISTINCT token_in FROM swaps WHERE source = 'agent' LIMIT ?`
        )
        .bind(MAX_TOKENS_PER_TICK)
        .all<{ token_in: string }>();
      for (const r of rows.results ?? []) {
        if (typeof r.token_in === "string" && r.token_in.length > 0) {
          set.add(r.token_in);
        }
      }
    }
    return Array.from(set).slice(0, MAX_TOKENS_PER_TICK);
  }

  private async readStored(): Promise<StoredScheduler> {
    const entries = (await this.ctx.storage.list({
      prefix: "",
    })) as Map<string, unknown>;
    const out: StoredScheduler = {};
    for (const [k, v] of entries) {
      if (k === "lastTeneroRunAt" && typeof v === "number") out.lastTeneroRunAt = v;
      else if (k === "lastTeneroResult") out.lastTeneroResult = v as TeneroRunResult;
      else if (k === "consecutiveFailures") out.consecutiveFailures = v as { tenero: number };
      else if (k === "pausedUntil" && typeof v === "number") out.pausedUntil = v;
      else if (k === "nextRunAfter") out.nextRunAfter = v as { tenero?: number };
    }
    return out;
  }

  private async persistTeneroResult(
    result: TeneroRunResult,
    opts: { rateLimited: boolean }
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
      nextRunAfter.tenero = Date.now() + TENERO_RATELIMIT_BACKOFF_MS;
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
