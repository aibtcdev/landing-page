/**
 * Cron-driven scheduler — orchestrates the periodic background tasks
 * (Tenero price refresh + competition Hiro catch-up sweep) from a
 * Cloudflare Cron Trigger instead of a Durable Object alarm.
 *
 * Why this replaced SchedulerDO (PR: scheduler cron migration):
 * the DO had no independent trigger — its alarm only stayed armed because
 * the /leaderboard SSR poked it on every render. After a DO storage wipe
 * (the v2→v3 class migration) with no leaderboard visit, the alarm was
 * never re-armed and ALL scheduled work silently stopped. A Cloudflare
 * Cron Trigger fires on a guaranteed schedule regardless of traffic.
 *
 * State that the DO held in `ctx.storage` now lives in KV (VERIFIED_AGENTS)
 * under `scheduler:*` keys. The competition cursor already lived in D1
 * (`competition_state`), so it is unaffected.
 *
 * Both task functions (`runTeneroTask`, `runCompetitionScheduler`) were
 * already DO-independent — this module just wires their dependencies,
 * gates cadence, and persists results, exactly as the DO wrapper did.
 */

import { getActiveTokenIds } from "../external/tenero";
import {
  runTeneroTask,
  TENERO_MINUTE_QUOTA_BACKOFF_MS,
  type TeneroRunResult,
} from "./tenero-task";
import {
  runCompetitionScheduler,
  type CompetitionSchedulerSummary,
} from "../competition/scheduler";
import { runEarningsSweep } from "../earnings/indexer";
import { EARNINGS_INTERVAL_MS } from "../earnings/constants";
import type { EarningsSweepSummary } from "../earnings/types";
import type { Logger } from "../logging";
import type {
  SchedulerStatus,
  SchedulerRefreshResult,
  SchedulerTask,
} from "./rpc-types";

// Cadences. The cron fires every TENERO_INTERVAL_MS; competition + earnings are
// gated to their longer intervals via a last-run check (mirrors the old DO alarm).
export const TENERO_INTERVAL_MS = 5 * 60 * 1000;
export const COMPETITION_INTERVAL_MS = 15 * 60 * 1000;

// KV keys (VERIFIED_AGENTS namespace).
const K_TENERO = "scheduler:tenero";
const K_COMPETITION = "scheduler:competition";
const K_EARNINGS = "scheduler:earnings";
const K_PAUSED = "scheduler:paused-until";

interface TeneroState {
  lastRunAt: number;
  result: TeneroRunResult;
  consecutiveFailures: number;
  /** Unix ms before which Tenero should not run again (rate-limit backoff). */
  nextRunAfter: number | null;
}

interface CompetitionState {
  lastRunAt: number;
  result: CompetitionSchedulerSummary;
  consecutiveFailures: number;
}

interface EarningsState {
  lastRunAt: number;
  result: EarningsSweepSummary;
  // Set by bumpFailure() on a thrown sweep; cleared when runEarningsNow()
  // overwrites the blob on the next successful run.
  consecutiveFailures?: number;
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function lookupTeneroApiKey(env: CloudflareEnv): string | undefined {
  const key = env.TENERO_API_KEY;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

// ─────────────────────────── pause / resume ───────────────────────────

export async function getPausedUntil(kv: KVNamespace): Promise<number | null> {
  const raw = await kv.get(K_PAUSED);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function pauseScheduler(
  kv: KVNamespace,
  until: number
): Promise<void> {
  await kv.put(K_PAUSED, String(until));
}

export async function resumeScheduler(kv: KVNamespace): Promise<void> {
  await kv.delete(K_PAUSED);
}

// ─────────────────────────── individual tasks ───────────────────────────

/**
 * Run the Tenero price refresh and persist its result + backoff to KV.
 * Honours `TENERO_REFRESH_ENABLED` (skips when not "true"), mirroring the
 * old DO wrapper so preview/local cannot consume production Tenero quota.
 */
export async function runTeneroNow(
  env: CloudflareEnv,
  parentLogger: Logger,
  // Optional pre-read state to avoid a duplicate K_TENERO read when the cron
  // tick already fetched it for its due-check. `undefined` = read it here;
  // `null` = caller read it and there was none.
  prevState?: TeneroState | null
): Promise<TeneroRunResult> {
  const logger = parentLogger.child
    ? parentLogger.child({ task: "tenero" })
    : parentLogger;
  const kv = env.VERIFIED_AGENTS;
  const startedAt = Date.now();

  if (env.TENERO_REFRESH_ENABLED !== "true") {
    logger.warn("tenero.refresh_skipped_disabled", {
      deployEnv: env.DEPLOY_ENV ?? "unset",
      teneroRefreshEnabled: env.TENERO_REFRESH_ENABLED ?? "unset",
    });
    return {
      startedAt,
      durationMs: Date.now() - startedAt,
      tokensAttempted: 0,
      succeeded: 0,
      failed: 0,
      minuteRemaining: null,
      monthRemaining: null,
    };
  }

  const tokenIds = await getActiveTokenIds(env.DB);
  logger.info("tenero.token_set_resolved", { count: tokenIds.length });

  const { result, rateLimited, rateLimitBackoffMs } = await runTeneroTask({
    logger,
    kv,
    tokenIds,
    apiKey: lookupTeneroApiKey(env),
  });

  const prev =
    prevState !== undefined ? prevState : await readJson<TeneroState>(kv, K_TENERO);
  const succeededCleanly =
    result.succeeded > 0 && result.failed === 0 && !rateLimited;
  const consecutiveFailures = succeededCleanly
    ? 0
    : result.failed > 0 || rateLimited
      ? (prev?.consecutiveFailures ?? 0) + 1
      : (prev?.consecutiveFailures ?? 0);
  const nextRunAfter = rateLimited
    ? Date.now() + (rateLimitBackoffMs ?? TENERO_MINUTE_QUOTA_BACKOFF_MS)
    : null;

  await kv.put(
    K_TENERO,
    JSON.stringify({
      lastRunAt: Date.now(),
      result,
      consecutiveFailures,
      nextRunAfter,
    } satisfies TeneroState)
  );

  return result;
}

/**
 * Run the competition Hiro catch-up sweep and persist its result to KV.
 * The sweep cursor itself lives in D1 (`competition_state`), so this is
 * resumable across cron ticks unchanged from the DO era.
 */
export async function runCompetitionNow(
  env: CloudflareEnv,
  parentLogger: Logger
): Promise<CompetitionSchedulerSummary> {
  const logger = parentLogger.child
    ? parentLogger.child({ task: "competition" })
    : parentLogger;

  const result = await runCompetitionScheduler(
    { DB: env.DB, HIRO_API_KEY: env.HIRO_API_KEY },
    logger
  );

  await env.VERIFIED_AGENTS.put(
    K_COMPETITION,
    JSON.stringify({
      lastRunAt: Date.now(),
      result,
      consecutiveFailures: 0,
    } satisfies CompetitionState)
  );

  return result;
}

/**
 * Run one earnings indexer sweep and persist its result to KV. Gated internally
 * by EARNINGS_INDEX_ENABLED (returns a disabled summary when off); the cursor
 * lives in D1 so it resumes across ticks. `lastRunAt` is persisted whether or
 * not the indexer is enabled, so the slow cadence is respected even while dormant.
 */
export async function runEarningsNow(
  env: CloudflareEnv,
  parentLogger: Logger,
  // `force` bypasses the EARNINGS_INDEX_ENABLED gate (operator-triggered admin
  // refresh). The cron tick calls without force, respecting the gate.
  force: boolean = false
): Promise<EarningsSweepSummary> {
  const logger = parentLogger.child
    ? parentLogger.child({ task: "earnings" })
    : parentLogger;

  const startedAt = Date.now();
  const result = await runEarningsSweep(env, logger, startedAt, force);

  await env.VERIFIED_AGENTS.put(
    K_EARNINGS,
    JSON.stringify({ lastRunAt: startedAt, result } satisfies EarningsState)
  );

  return result;
}

// ─────────────────────────── cron entry point ───────────────────────────

/**
 * One cron tick. Runs Tenero every tick (respecting rate-limit backoff)
 * and the competition sweep on its longer cadence. A failure in one task
 * is logged and its failure counter bumped, but never blocks the other.
 *
 * Idempotency note: if a slow tick overruns the cron interval and a second
 * tick starts concurrently, no harm results — Tenero overwrites KV and the
 * competition sweep uses `INSERT OR IGNORE` on (txid). The DO previously
 * serialized this; cron does not, which is acceptable given idempotency.
 */
export async function runScheduledTasks(
  env: CloudflareEnv,
  logger: Logger,
  now: number = Date.now()
): Promise<void> {
  const kv = env.VERIFIED_AGENTS;

  const pausedUntil = await getPausedUntil(kv);
  if (pausedUntil && pausedUntil > now) {
    logger.info("scheduler.skipped_paused", { pausedUntil });
    return;
  }

  const [tenero, competition, earnings] = await Promise.all([
    readJson<TeneroState>(kv, K_TENERO),
    readJson<CompetitionState>(kv, K_COMPETITION),
    readJson<EarningsState>(kv, K_EARNINGS),
  ]);

  // Tenero — every tick, unless inside a rate-limit backoff window.
  const teneroBackoff = tenero?.nextRunAfter ?? 0;
  const teneroDue =
    teneroBackoff <= now &&
    (tenero?.lastRunAt ?? 0) + TENERO_INTERVAL_MS <= now + 1_000;
  if (teneroDue) {
    try {
      await runTeneroNow(env, logger, tenero);
    } catch (error) {
      logger.error("scheduler.tenero_unexpected_error", {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await bumpFailure(kv, K_TENERO);
    }
  } else {
    logger.debug("scheduler.tenero_not_due", {
      lastRunAt: tenero?.lastRunAt ?? null,
      nextRunAfter: teneroBackoff || null,
    });
  }

  // Competition — on its longer cadence.
  const competitionDue =
    (competition?.lastRunAt ?? 0) + COMPETITION_INTERVAL_MS <= now + 1_000;
  if (competitionDue) {
    try {
      await runCompetitionNow(env, logger);
    } catch (error) {
      logger.error("scheduler.competition_unexpected_error", {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await bumpFailure(kv, K_COMPETITION);
    }
  } else {
    logger.debug("scheduler.competition_not_due", {
      lastRunAt: competition?.lastRunAt ?? null,
    });
  }

  // Earnings indexer — on its slow cadence. Internally gated by
  // EARNINGS_INDEX_ENABLED, so this is a single no-op log while dormant.
  const earningsDue =
    (earnings?.lastRunAt ?? 0) + EARNINGS_INTERVAL_MS <= now + 1_000;
  if (earningsDue) {
    try {
      await runEarningsNow(env, logger);
    } catch (error) {
      logger.error("scheduler.earnings_unexpected_error", {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await bumpFailure(kv, K_EARNINGS);
    }
  } else {
    logger.debug("scheduler.earnings_not_due", {
      lastRunAt: earnings?.lastRunAt ?? null,
    });
  }
}

async function bumpFailure(kv: KVNamespace, key: string): Promise<void> {
  const prev = await readJson<{ consecutiveFailures?: number }>(kv, key);
  const next = { ...(prev ?? {}), consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1 };
  await kv.put(key, JSON.stringify(next));
}

// ─────────────────────────── admin surface ───────────────────────────

/** Compose the status payload the admin endpoint serves. */
export async function readSchedulerStatus(
  kv: KVNamespace
): Promise<SchedulerStatus> {
  const [tenero, competition, earnings, pausedUntil] = await Promise.all([
    readJson<TeneroState>(kv, K_TENERO),
    readJson<CompetitionState>(kv, K_COMPETITION),
    readJson<EarningsState>(kv, K_EARNINGS),
    getPausedUntil(kv),
  ]);

  return {
    now: Date.now(),
    pausedUntil: pausedUntil ?? null,
    lastTeneroRunAt: tenero?.lastRunAt ?? null,
    lastTeneroResult: tenero?.result ?? null,
    lastCompetitionRunAt: competition?.lastRunAt ?? null,
    lastCompetitionResult: competition?.result ?? null,
    lastEarningsRunAt: earnings?.lastRunAt ?? null,
    lastEarningsResult: earnings?.result ?? null,
    consecutiveFailures: {
      tenero: tenero?.consecutiveFailures ?? 0,
      competition: competition?.consecutiveFailures ?? 0,
      earnings: earnings?.consecutiveFailures ?? 0,
    },
    nextRunAfter: {
      tenero: tenero?.nextRunAfter ?? null,
      competition: null,
    },
    // Cron-driven: there is no single self-scheduled alarm to report.
    nextAlarmAt: null,
  };
}

/** Manual operator-triggered run, used by POST /api/admin/scheduler. */
export async function refreshScheduler(
  env: CloudflareEnv,
  logger: Logger,
  task: SchedulerTask
): Promise<SchedulerRefreshResult> {
  const out: SchedulerRefreshResult = {};
  if (task === "tenero" || task === "all") {
    out.tenero = await runTeneroNow(env, logger);
  }
  if (task === "competition" || task === "all") {
    out.competition = await runCompetitionNow(env, logger);
  }
  if (task === "earnings" || task === "all") {
    // Operator-triggered: force past the dormant gate so a sweep can be verified.
    out.earnings = await runEarningsNow(env, logger, true);
  }
  return out;
}
