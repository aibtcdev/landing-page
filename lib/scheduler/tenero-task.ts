/**
 * Tenero refresh task — pure orchestration of fetch + KV writes for the
 * scheduler's per-tick price refresh.
 *
 * Extracted out of `SchedulerDO` (in `worker.ts`) so it can be tested
 * without spinning up a Durable Object harness. The DO method becomes
 * a thin wrapper that wires the dependencies and persists the result
 * to DO storage; the actual fetch/cache/rate-limit logic lives here.
 *
 * Pattern follows `x402-sponsor-relay`'s split between durable-object
 * orchestration and pure task functions.
 */

import { fetchTokenPriceUsd } from "../external/tenero";
import {
  getCachedTokenPrice,
  setCachedTokenPrice,
} from "../external/tenero/kv-cache";
import type { Logger } from "../logging";

export interface TeneroRunResult {
  startedAt: number;
  durationMs: number;
  tokensAttempted: number;
  succeeded: number;
  failed: number;
  minuteRemaining: number | null;
  monthRemaining: number | null;
}

export interface TeneroTaskDeps {
  logger: Logger;
  kv: KVNamespace;
  tokenIds: readonly string[];
  apiKey?: string;
  /** Test injection point. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Delay (ms) between token fetches to stay under Tenero's per-minute cap.
   * Production passes `TENERO_REQUEST_SPACING_MS`; defaults to 0 (no delay) so
   * tests run instantly.
   */
  spacingMs?: number;
}

export interface TeneroTaskOutcome {
  result: TeneroRunResult;
  /**
   * True when Tenero signalled rate-limiting during the run (HTTP 429 OR
   * `x-ratelimit-minute-remaining <= 0`). Caller writes this to
   * DO-storage `nextRunAfter.tenero` for adaptive backoff.
   */
  rateLimited: boolean;
  /**
   * Suggested scheduler backoff. Monthly quota exhaustion needs a much
   * longer pause than minute-level throttling.
   */
  rateLimitBackoffMs?: number;
}

export const TENERO_MINUTE_QUOTA_BACKOFF_MS = 5 * 60 * 1000;
export const TENERO_MONTH_QUOTA_BACKOFF_MS = 24 * 60 * 60 * 1000;

/**
 * Inter-request spacing to stay under Tenero's per-minute API cap (Starter plan
 * = 10 req/min). ~6.6s between fetches → ≤~9/min, so a full token sweep never
 * trips the minute limit — no more `minute_quota_exhausted` mid-run breaks or
 * 429 backoffs. Production passes this via `deps.spacingMs`; the pure task
 * defaults to 0 (no delay) so tests stay instant.
 */
export const TENERO_REQUEST_SPACING_MS = 6_600;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Skip the KV rewrite when the fetched price equals the cached one and the
 * cached entry is younger than this. KV writes are the tightest paid-plan
 * quota (1M/mo; this task alone was ~458k/mo at 53 tokens × 5-min cadence)
 * while the comparison read costs 10x less than the write it avoids. The
 * periodic rewrite past this age keeps `fetchedAt` honest for readers and
 * renews the 24h KV TTL safety net.
 */
export const TENERO_UNCHANGED_REWRITE_MS = 60 * 60 * 1000;

export async function runTeneroTask(
  deps: TeneroTaskDeps
): Promise<TeneroTaskOutcome> {
  const { logger, kv, tokenIds, apiKey } = deps;
  const now = deps.now ?? Date.now;
  const spacingMs = deps.spacingMs ?? 0;
  const startedAt = now();

  logger.info("tenero.refresh_started", { tokenCount: tokenIds.length });

  let succeeded = 0;
  let failed = 0;
  let lastMinuteRemaining: number | null = null;
  let lastMonthRemaining: number | null = null;
  let rateLimited = false;
  let rateLimitBackoffMs: number | undefined;

  let firstToken = true;
  for (const tokenId of tokenIds) {
    // Pace requests under the per-minute API cap (see TENERO_REQUEST_SPACING_MS).
    if (!firstToken) await sleep(spacingMs);
    firstToken = false;

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
        const prev = await getCachedTokenPrice(kv, tokenId);
        const unchanged =
          prev !== null &&
          prev.priceUsd === r.priceUsd &&
          now() - prev.fetchedAt < TENERO_UNCHANGED_REWRITE_MS;
        if (!unchanged) {
          await setCachedTokenPrice(kv, tokenId, {
            priceUsd: r.priceUsd,
            fetchedAt: now(),
            minuteRemaining: r.rateLimit.minuteRemaining,
            monthRemaining: r.rateLimit.monthRemaining,
          });
        }
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
      r.rateLimit.monthRemaining !== null &&
      r.rateLimit.monthRemaining <= 0
    ) {
      rateLimited = true;
      rateLimitBackoffMs = TENERO_MONTH_QUOTA_BACKOFF_MS;
      logger.warn("tenero.month_quota_exhausted_mid_run", {
        rlMonthRemaining: r.rateLimit.monthRemaining,
        processed: succeeded + failed,
        remaining: tokenIds.length - (succeeded + failed),
      });
      break;
    }

    if (
      r.rateLimit.minuteRemaining !== null &&
      r.rateLimit.minuteRemaining <= 0
    ) {
      rateLimited = true;
      rateLimitBackoffMs ??= TENERO_MINUTE_QUOTA_BACKOFF_MS;
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
    durationMs: now() - startedAt,
    tokensAttempted: tokenIds.length,
    succeeded,
    failed,
    minuteRemaining: lastMinuteRemaining,
    monthRemaining: lastMonthRemaining,
  };

  logger.info("tenero.refresh_completed", {
    succeeded,
    failed,
    durationMs: result.durationMs,
    rlMinuteRemaining: lastMinuteRemaining,
    rlMonthRemaining: lastMonthRemaining,
    rateLimited,
  });

  return { result, rateLimited, rateLimitBackoffMs };
}
