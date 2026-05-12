/**
 * SchedulerDO — single Durable Object that coordinates periodic background
 * work for landing-page. See issue #768 for the full design rationale.
 *
 * Initial scope: Tenero price refresh task (every ~5 min). The competition
 * Hiro sweep task lands in a follow-up; only Tenero is wired here so the
 * leaderboard PR has a self-contained shippable surface.
 *
 * Storage layout (this.ctx.storage):
 * - `lastTeneroRunAt`     — unix millis when the Tenero task last completed
 * - `lastTeneroResult`    — `{ succeeded, failed, minuteRemaining, monthRemaining }`
 * - `consecutiveFailures` — `{ tenero: number }` (sweep added later)
 * - `pausedUntil`         — unix millis; alarm() is a no-op until this passes
 * - `nextRunAfter`        — `{ tenero?: number }`; adaptive backoff floor per task
 *
 * Long-lived cursors (competition sweep) stay in D1 per issue #768 — the DO
 * does not hold authoritative data, only its own bookkeeping.
 *
 * Failure policy: per-task try/catch inside `alarm()`. A task failure is
 * logged and the alarm continues — the next scheduled tick is the recovery
 * path. Only transport-level failures (storage write fails, env binding
 * missing) re-throw to trigger the runtime's auto-retry.
 *
 * Logging: routed through `env.LOGS` via the standard
 * `isLogsRPC(env.LOGS) ? createLogger : createConsoleLogger` switch.
 * Console fallback is deliberately preserved here because `wrangler tail` on
 * DO instances is the local-dev debug path — but in deployed contexts
 * `env.LOGS` is always present, so events land in `logs.aibtc.com`.
 */

import { DurableObject } from "cloudflare:workers";
import {
  createConsoleLogger,
  createLogger,
  isLogsRPC,
  type Logger,
} from "../logging";
import { fetchTokenPriceUsd } from "../external/tenero";
import { setCachedTokenPrice } from "../external/tenero/kv-cache";

/** Tenero refresh cadence — see issue #768 "Decision" section. */
const TENERO_INTERVAL_MS = 5 * 60 * 1000;

/** Alarm tick cadence. Set to the shortest task cadence; per-task gating happens inside alarm(). */
const ALARM_TICK_MS = TENERO_INTERVAL_MS;

/**
 * Cap on tokens refreshed per alarm tick. Hard ceiling against runaway D1
 * results blowing up the alarm duration. 30 tokens × ~500ms ≈ 15s budget.
 */
const MAX_TOKENS_PER_TICK = 30;

/**
 * Static base token set — always refreshed regardless of swap activity.
 * Mirrors `TOKEN_DECIMALS` in `app/leaderboard/page.tsx`; keep in sync when
 * adding new known tokens to the leaderboard.
 */
const STATIC_TOKEN_IDS: readonly string[] = [
  "stx",
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc",
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx",
];

/** Backoff applied when Tenero reports minute-quota exhausted. */
const TENERO_RATELIMIT_BACKOFF_MS = 5 * 60 * 1000;

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
    // Ensure an alarm is always armed. Idempotent — getAlarm() returns null
    // if none is set, and setAlarm() with a past timestamp fires immediately.
    this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current === null) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
      }
    });
  }

  // ───────────────────── RPC surface ─────────────────────

  /** Snapshot of the DO's bookkeeping. Safe to call from any route. */
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

  /** Fire the named task now. Returns the task result. */
  async refreshNow(task: "tenero" | "all"): Promise<{ tenero?: TeneroRunResult }> {
    const logger = this.makeLogger({ trigger: "refreshNow", task });
    const out: { tenero?: TeneroRunResult } = {};
    if (task === "tenero" || task === "all") {
      out.tenero = await this.runTenero(logger);
    }
    return out;
  }

  /** Pause all tasks until the given timestamp. Use for ops kill switch. */
  async pauseUntil(timestamp: number): Promise<void> {
    await this.ctx.storage.put("pausedUntil", timestamp);
    this.makeLogger({ trigger: "pauseUntil" }).warn("scheduler.paused", {
      pausedUntil: timestamp,
    });
  }

  /** Clear any pause. */
  async resume(): Promise<void> {
    await this.ctx.storage.delete("pausedUntil");
    this.makeLogger({ trigger: "resume" }).info("scheduler.resumed", {});
  }

  // ───────────────────── alarm() ─────────────────────

  async alarm(): Promise<void> {
    const tickStartedAt = Date.now();
    const logger = this.makeLogger({ trigger: "alarm", tickStartedAt });

    // Always re-arm the next alarm before returning, even on failure. This
    // is the recovery path — if a task throws and we skip re-arming, the DO
    // goes silent forever.
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
        (stored.lastTeneroRunAt ?? 0) + TENERO_INTERVAL_MS <= tickStartedAt + 1_000;

      if (teneroDue) {
        try {
          await this.runTenero(logger);
        } catch (error) {
          // Tenero task threw something it didn't catch internally —
          // log and continue. Future tasks (sweep) will get their own try.
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

  // ───────────────────── Tenero task ─────────────────────

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
        // Even a 200 with null priceUsd is "Tenero confirmed no price" —
        // cache that so we don't re-probe every tick.
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
        // Non-200, non-429, non-5xx — treat as failure (no price written).
        failed++;
      }

      // Hard stop if Tenero says we're out of minute quota.
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

  /**
   * Active token set = static base ∪ distinct `token_in` from D1 `swaps`
   * where source='agent'. Bounded by {@link MAX_TOKENS_PER_TICK}.
   */
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

  // ───────────────────── storage helpers ─────────────────────

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
      // Clean run — clear failure counter and any pending backoff.
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

  // ───────────────────── logging ─────────────────────

  private makeLogger(extra: Record<string, unknown>): Logger {
    const ctxBase = {
      path: "/__do/scheduler",
      doName: "scheduler",
      ...extra,
    };
    // DurableObjectState exposes `waitUntil`, which is all createLogger needs.
    return isLogsRPC(this.env.LOGS)
      ? createLogger(this.env.LOGS, this.ctx, ctxBase)
      : createConsoleLogger(ctxBase);
  }

  /**
   * Tenero API key lookup — currently unset. The env type is intentionally
   * loose so we can wire `env.TENERO_API_KEY` here without touching call
   * sites if/when a key is provisioned.
   */
  private lookupTeneroApiKey(): string | undefined {
    const key = (this.env as unknown as { TENERO_API_KEY?: string })
      .TENERO_API_KEY;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  }
}
