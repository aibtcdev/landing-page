/**
 * Shared Tenero API fetch wrapper with bounded retry + structured logging.
 *
 * Modeled on `lib/stacks-api-fetch.ts` (Hiro wrapper). Differences vs. Hiro:
 * - Smaller default 429 retry budget. Tenero's unauthenticated tier is
 *   web-ui-ip / 100-per-minute / 50k-per-month, and from a Worker the source
 *   IP is a shared CF-datacenter egress IP. Aggressive retry on 429 only
 *   speeds up the lockout. The SchedulerDO's next alarm tick is the recovery
 *   path, not in-attempt retry.
 * - Parses `x-ratelimit-*` rate-limit headers (minute + month remaining) so
 *   callers can surface them up to the scheduler for adaptive cadence.
 * - Optional `TENERO_API_KEY` is threaded through as `x-api-key`. The header
 *   name is the common Tenero convention; if their auth header turns out to
 *   be different, change it here only.
 *
 * Observability: callers thread a {@link Logger} from the worker-logs
 * pipeline (via `isLogsRPC(env.LOGS) ? createLogger : createConsoleLogger`
 * — see `lib/logging.ts`). The wrapper is silent when no logger is given;
 * it never falls back to `console.*`, which would bypass the telemetry sink
 * and recreate the observability bug the rev'd revert was trying to fix.
 */

import type { Logger } from "../logging";

const TENERO_API_BASE = "https://api.tenero.io/v1/stacks";

/** Build headers for Tenero API requests, optionally including an API key. */
export function buildTeneroHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "aibtc-landing-page/1.0 (+https://aibtc.com)",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

/** Parsed Tenero rate-limit headers. */
export interface TeneroRateLimit {
  /** Remaining requests this minute (x-ratelimit-minute-remaining). */
  minuteRemaining: number | null;
  /** Remaining requests this month (x-ratelimit-month-remaining). */
  monthRemaining: number | null;
  /** Rate-limit tier label (x-ratelimit-type, e.g. "web-ui-ip"). */
  type: string | null;
}

function parseIntHeader(response: Response, name: string): number | null {
  const val = response.headers.get(name);
  if (!val) return null;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

export function extractTeneroRateLimit(response: Response): TeneroRateLimit {
  return {
    minuteRemaining: parseIntHeader(response, "x-ratelimit-minute-remaining"),
    monthRemaining: parseIntHeader(response, "x-ratelimit-month-remaining"),
    type: response.headers.get("x-ratelimit-type"),
  };
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Per-attempt fetch timeout. */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

/** Cap Retry-After at 30s — the alarm tick handles longer recovery. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Default retry budget: small on purpose — see file header. */
const DEFAULT_429_RETRIES = 2;
const DEFAULT_5XX_RETRIES = 2;
const DEFAULT_429_BASE_DELAY_MS = 1_500;
const DEFAULT_5XX_BASE_DELAY_MS = 500;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(response: Response): number | null {
  const headerValue = response.headers.get("Retry-After");
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TeneroFetchConfig {
  /** Max attempts for 5xx errors (default: 2). */
  retries?: number;
  /** Base delay for 5xx exponential backoff in ms (default: 500). */
  baseDelayMs?: number;
  /** Max attempts for 429 rate-limit errors (default: 2). */
  retries429?: number;
  /**
   * Optional Logger; when provided, emits `tenero.*` telemetry events.
   * Silent when omitted — we do not fall back to console.*, which would
   * bypass the worker-logs pipeline.
   */
  logger?: Logger;
  /** Optional Tenero API key (sent as x-api-key). */
  apiKey?: string;
}

/**
 * Fetch a Tenero API path with bounded retry on 429/5xx.
 *
 * Pass a relative path like `/tokens/SP...sbtc-token` — the base URL is
 * concatenated internally so the wrapper owns the host. Each attempt has an
 * independent {@link PER_ATTEMPT_TIMEOUT_MS} timeout. After retries are
 * exhausted, the final Response is returned for the caller to inspect.
 *
 * @returns Final Response (status may be 2xx, 429, 5xx, or other 4xx)
 * @throws Only on network-level errors after all retries are exhausted
 */
export async function teneroFetch(
  path: string,
  config: TeneroFetchConfig = {}
): Promise<Response> {
  const {
    retries = DEFAULT_5XX_RETRIES,
    baseDelayMs = DEFAULT_5XX_BASE_DELAY_MS,
    retries429 = DEFAULT_429_RETRIES,
    logger,
    apiKey,
  } = config;

  const url = `${TENERO_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const logPath = extractPath(url);
  const headers = buildTeneroHeaders(apiKey);

  let attempts429 = 0;
  let attempts5xx = 0;
  const maxTotal = retries429 + retries + 1;
  let total = 0;

  while (total < maxTotal) {
    total++;
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
      });

      const rl = extractTeneroRateLimit(response);
      if (rl.minuteRemaining !== null && rl.minuteRemaining <= 5) {
        logger?.warn("tenero.minute_quota_low", {
          path: logPath,
          rlMinuteRemaining: rl.minuteRemaining,
          rlType: rl.type,
        });
      }
      if (rl.monthRemaining !== null && rl.monthRemaining <= 5_000) {
        logger?.warn("tenero.month_quota_low", {
          path: logPath,
          rlMonthRemaining: rl.monthRemaining,
          rlType: rl.type,
        });
      }

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      const cfRay = response.headers.get("cf-ray");
      const is429 = response.status === 429;

      if (is429) {
        attempts429++;
        if (attempts429 > retries429) {
          logger?.warn("tenero.retry_budget_exhausted", {
            path: logPath,
            status: 429,
            attempts: attempts429,
            budget: "429",
            rlMinuteRemaining: rl.minuteRemaining,
            rlMonthRemaining: rl.monthRemaining,
            ...(cfRay ? { cfRay } : {}),
          });
          return response;
        }

        const retryAfterMs =
          parseRetryAfterMs(response) ??
          DEFAULT_429_BASE_DELAY_MS * Math.pow(2, attempts429 - 1);
        const delayMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
        logger?.warn("tenero.retrying", {
          path: logPath,
          status: 429,
          attempt: attempts429,
          maxAttempts: retries429,
          delayMs,
          ...(cfRay ? { cfRay } : {}),
        });
        await sleep(delayMs);
      } else {
        attempts5xx++;
        if (attempts5xx > retries) {
          logger?.warn("tenero.retry_budget_exhausted", {
            path: logPath,
            status: response.status,
            attempts: attempts5xx,
            budget: "5xx",
            ...(cfRay ? { cfRay } : {}),
          });
          return response;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
        logger?.warn("tenero.retrying", {
          path: logPath,
          status: response.status,
          attempt: attempts5xx,
          maxAttempts: retries,
          delayMs,
          ...(cfRay ? { cfRay } : {}),
        });
        await sleep(delayMs);
      }
    } catch (error) {
      attempts5xx++;
      if (attempts5xx > retries) {
        logger?.warn("tenero.retry_budget_exhausted", {
          path: logPath,
          attempts: attempts5xx,
          budget: "network",
          error: String(error),
        });
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
      logger?.warn("tenero.retrying", {
        path: logPath,
        attempt: attempts5xx,
        maxAttempts: retries,
        delayMs,
        budget: "network",
        error: String(error),
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`[teneroFetch] Unexpected: retry loop exited without return`);
}
