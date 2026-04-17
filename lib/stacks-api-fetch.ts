/**
 * Shared Stacks API fetch wrapper with exponential backoff retry.
 *
 * Provides resilience for transient 429 (rate limit) and 5xx (server error)
 * responses from the Hiro Stacks API. Used by callReadOnly() in
 * lib/identity/stacks-api.ts and verifyTxidPayment() in lib/inbox/x402-verify.ts.
 *
 * Retry strategy:
 * - 429 rate-limit responses: up to 5 attempts with 1s base delay (1s, 2s, 4s, 8s, 16s)
 * - 5xx server errors: up to 3 attempts with 500ms base delay (500ms, 1s, 2s)
 * - Respects Retry-After header on 429 (capped at 30s)
 * - Per-attempt timeout: 8 seconds
 * - Returns the final Response after all retries — callers check status
 *
 * Observability: callers may thread an optional {@link Logger}. When provided,
 * rate-limit and retry events are emitted as structured `stacksApi.*` events
 * (via worker-logs); otherwise the wrapper is silent (no console fallback —
 * that would bypass the telemetry pipeline).
 */

import type { Logger } from "./logging";

/** Build headers for Hiro API requests, optionally including an API key. */
export function buildHiroHeaders(hiroApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hiroApiKey) {
    headers["X-Hiro-API-Key"] = hiroApiKey;
  }
  return headers;
}

/**
 * Extract a stable pathname suffix from a URL for use as a log key.
 * Falls back to the raw url if parsing fails (e.g. relative URL).
 */
function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Detect 429 rate limit responses and log cf-ray for observability.
 *
 * @returns Object with isRateLimited flag for caller branching
 */
export function detect429(
  response: Response,
  logger?: Logger
): {
  isRateLimited: boolean;
} {
  const isRateLimited = response.status === 429;

  if (isRateLimited) {
    const cfRay = response.headers.get("cf-ray");
    logger?.warn("stacksApi.rate_limited", {
      path: extractPath(response.url),
      url: response.url,
      ...(cfRay ? { cfRay } : {}),
    });
  }

  return { isRateLimited };
}

/** Rate limit warning threshold — warn when remaining drops below this value. */
const RATE_LIMIT_WARN_THRESHOLD = 50;

/** Parsed Hiro API rate limit headers from a response. */
export interface RateLimitInfo {
  /** Remaining requests in the current window (ratelimit-remaining). */
  remaining: number | null;
  /** Total request budget for the current window (ratelimit-limit). */
  limit: number | null;
  /** Seconds until the current window resets (ratelimit-reset). */
  reset: number | null;
  /** Remaining per-minute request budget (x-ratelimit-remaining-stacks-minute). */
  remainingMinute: number | null;
  /** API cost units consumed by this request (x-ratelimit-cost-stacks). */
  costStacks: number | null;
}

/**
 * Extract Hiro API rate limit headers from a response.
 *
 * Reads ratelimit-remaining, ratelimit-limit, ratelimit-reset,
 * x-ratelimit-remaining-stacks-minute, and x-ratelimit-cost-stacks.
 *
 * When a logger is provided, emits two structured events:
 * - `stacksApi.rate_limit_remaining` on every parseable response (for tracking
 *   how the remaining budget trends as cache hit rates rise).
 * - `stacksApi.approaching_rate_limit` (warn level) when remaining drops below
 *   RATE_LIMIT_WARN_THRESHOLD (50), so operators are alerted before key
 *   exhaustion.
 *
 * @param response - The Response object from a Hiro API fetch
 * @param logger - Optional Logger for emitting rate-limit telemetry
 * @param path - Optional precomputed pathname (avoids re-parsing response.url)
 * @returns Parsed rate limit fields (null for any header that is absent or unparseable)
 */
export function extractRateLimitInfo(
  response: Response,
  logger?: Logger,
  path?: string
): RateLimitInfo {
  function parseIntHeader(name: string): number | null {
    const val = response.headers.get(name);
    if (!val) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }

  const remaining = parseIntHeader("ratelimit-remaining");
  const limit = parseIntHeader("ratelimit-limit");
  const reset = parseIntHeader("ratelimit-reset");
  const remainingMinute = parseIntHeader("x-ratelimit-remaining-stacks-minute");
  const costStacks = parseIntHeader("x-ratelimit-cost-stacks");

  if (logger && remaining !== null) {
    const resolvedPath = path ?? extractPath(response.url);
    logger.info("stacksApi.rate_limit_remaining", {
      path: resolvedPath,
      rlRemaining: remaining,
      ...(limit !== null ? { rlLimit: limit } : {}),
      ...(reset !== null ? { rlReset: reset } : {}),
      ...(remainingMinute !== null ? { rlRemainingMinute: remainingMinute } : {}),
      ...(costStacks !== null ? { rlCostStacks: costStacks } : {}),
    });

    if (remaining < RATE_LIMIT_WARN_THRESHOLD) {
      logger.warn("stacksApi.approaching_rate_limit", {
        path: resolvedPath,
        rlRemaining: remaining,
        ...(limit !== null ? { rlLimit: limit } : {}),
        ...(reset !== null ? { rlReset: reset } : {}),
        threshold: RATE_LIMIT_WARN_THRESHOLD,
      });
    }
  }

  return { remaining, limit, reset, remainingMinute, costStacks };
}

/** Per-attempt fetch timeout in milliseconds. */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

/** Maximum delay from Retry-After header (milliseconds). */
const MAX_RETRY_AFTER_MS = 30_000;

/** Max retries for 429 rate-limit responses (separate budget from 5xx errors). */
const RATE_LIMIT_RETRIES = 5;

/** Base delay for 429-specific exponential backoff (1s, 2s, 4s, 8s, 16s). */
const RATE_LIMIT_BASE_DELAY_MS = 1_000;

/**
 * Determine if a response status warrants a retry.
 * Retries on 429 (rate limited) and any 5xx (server errors).
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Parse Retry-After header value into milliseconds.
 * Handles numeric seconds only (not HTTP-date format).
 * Returns null if header is absent or unparseable.
 */
export function parseRetryAfterMs(response: Response): number | null {
  const headerValue = response.headers.get("Retry-After");
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (isNaN(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry + observability configuration for {@link stacksApiFetch}. */
export interface StacksApiFetchConfig {
  /** Max attempts for 5xx errors (default: 3). */
  retries?: number;
  /** Base delay for 5xx exponential backoff in ms (default: 500). */
  baseDelayMs?: number;
  /** Max attempts for 429 rate-limit errors (default: {@link RATE_LIMIT_RETRIES} = 5). */
  retries429?: number;
  /**
   * Optional Logger; when provided, emits `stacksApi.*` telemetry events
   * (rate_limit_remaining, approaching_rate_limit, retry_budget_exhausted,
   * retrying). Silent when omitted — we do not fall back to `console.*`,
   * which would bypass the worker-logs pipeline.
   */
  logger?: Logger;
}

/**
 * Fetch a Stacks API URL with exponential backoff retry on 429/5xx responses.
 *
 * Each attempt uses an independent AbortSignal with a per-attempt timeout.
 *
 * 429 rate-limit responses use a separate retry budget (`retries429`, default 5)
 * with a longer base delay (1s, 2s, 4s, 8s, 16s) to absorb burst rate limits.
 * The Retry-After header from Hiro takes precedence over computed backoff (capped at 30s).
 *
 * 5xx server errors use the standard retry budget (`retries`, default 3) with
 * 500ms base delay (500ms, 1s, 2s).
 *
 * On successful response (2xx or non-retryable 4xx), returns immediately.
 * After all retries for a given error type are exhausted, returns the last
 * Response so the caller can inspect status and body.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (method, headers, body). Signal is injected per-attempt.
 * @param config - Retry + observability config; pass just `{ logger }` when the
 *                 defaults are fine, or override any retry field individually.
 * @returns The final Response object
 * @throws Only on network-level errors (DNS failure, connection refused) after all retries
 */
export async function stacksApiFetch(
  url: string,
  options: RequestInit,
  config: StacksApiFetchConfig = {}
): Promise<Response> {
  const {
    retries = 3,
    baseDelayMs = 500,
    retries429 = RATE_LIMIT_RETRIES,
    logger,
  } = config;
  const path = extractPath(url);

  // Separate retry budgets for 429 and 5xx
  let attempts429 = 0;
  let attempts5xx = 0;

  // Total attempt loop — bounded by the larger of the two budgets
  const maxTotalAttempts = retries429 + retries;
  let totalAttempts = 0;

  while (totalAttempts < maxTotalAttempts) {
    totalAttempts++;
    const attemptOptions: RequestInit = {
      ...options,
      signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
    };

    try {
      const response = await fetch(url, attemptOptions);

      // Extract rate limit info on every response for observability (also emits
      // stacksApi.rate_limit_remaining / approaching_rate_limit when logger present)
      const rl = extractRateLimitInfo(response, logger, path);

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      const is429 = response.status === 429;

      if (is429) {
        attempts429++;
        if (attempts429 >= retries429) {
          // Exhausted 429 retry budget — return final response to caller
          logger?.warn("stacksApi.retry_budget_exhausted", {
            path,
            url,
            status: 429,
            attempts: retries429,
            budget: "429",
            ...(rl.remaining !== null ? { rlRemaining: rl.remaining } : {}),
            ...(rl.limit !== null ? { rlLimit: rl.limit } : {}),
          });
          return response;
        }

        // Prefer Retry-After header, otherwise exponential backoff with 1s base
        const retryAfterMs =
          parseRetryAfterMs(response) ??
          RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempts429 - 1);
        const delayMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
        logger?.warn("stacksApi.retrying", {
          path,
          url,
          status: 429,
          attempt: attempts429,
          maxAttempts: retries429,
          delayMs,
          ...(rl.remaining !== null ? { rlRemaining: rl.remaining } : {}),
        });
        await sleep(delayMs);
      } else {
        // 5xx error
        attempts5xx++;
        if (attempts5xx >= retries) {
          logger?.warn("stacksApi.retry_budget_exhausted", {
            path,
            url,
            status: response.status,
            attempts: retries,
            budget: "5xx",
            ...(rl.remaining !== null ? { rlRemaining: rl.remaining } : {}),
            ...(rl.limit !== null ? { rlLimit: rl.limit } : {}),
          });
          return response;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
        logger?.warn("stacksApi.retrying", {
          path,
          url,
          status: response.status,
          attempt: attempts5xx,
          maxAttempts: retries,
          delayMs,
          ...(rl.remaining !== null ? { rlRemaining: rl.remaining } : {}),
        });
        await sleep(delayMs);
      }
    } catch (error) {
      // Network-level error — counts against the 5xx budget
      attempts5xx++;
      if (attempts5xx >= retries) {
        logger?.warn("stacksApi.retry_budget_exhausted", {
          path,
          url,
          attempts: retries,
          budget: "network",
          error: String(error),
        });
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
      logger?.warn("stacksApi.retrying", {
        path,
        url,
        attempt: attempts5xx,
        maxAttempts: retries,
        delayMs,
        error: String(error),
        budget: "network",
      });
      await sleep(delayMs);
    }
  }

  // Unreachable -- loop always returns or throws when a budget is exhausted
  throw new Error(`[stacksApiFetch] Unexpected: retry loop exited without return`);
}
