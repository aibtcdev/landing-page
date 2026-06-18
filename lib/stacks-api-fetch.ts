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
    // Hiro's documented header is `x-api-key`. The legacy `x-hiro-api-key` was
    // deprecated and stopped authenticating (~June 2026) — sending only it makes
    // requests anonymous → 429 rate-limiting on the shared Worker IP. Send the
    // documented header (plus the legacy one for safety).
    headers["x-api-key"] = hiroApiKey;
    headers["x-hiro-api-key"] = hiroApiKey;
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

/**
 * Warn when monthly remaining drops below this fraction of the monthly limit.
 * Percentage-based so it adapts to whichever plan tier the API key is on.
 */
const MONTHLY_QUOTA_WARN_FRACTION = 0.2;

/** Parsed Hiro API monthly rate limit headers from a response. */
export interface RateLimitInfo {
  /** Remaining requests this month (x-ratelimit-remaining-stacks-month). */
  remainingMonth: number | null;
  /** Monthly request ceiling (x-ratelimit-limit-stacks-month). */
  limitMonth: number | null;
  /** API cost units consumed by this request (x-ratelimit-cost-stacks). */
  costStacks: number | null;
}

/**
 * Extract Hiro API monthly quota headers from a response and warn when low.
 *
 * Per-second / per-minute headers are intentionally ignored — short-window
 * 429s are already absorbed by the retry logic in {@link stacksApiFetch}, so
 * surfacing them as warns just creates noise. The monthly quota, by contrast,
 * is the signal that actually requires action (plan upgrade or traffic shed).
 *
 * Emits `stacksApi.approaching_monthly_quota` (warn) when remaining drops
 * below {@link MONTHLY_QUOTA_WARN_FRACTION} of the monthly limit. Once
 * triggered it will fire on every subsequent call until the month rolls over;
 * dedupe at the alerting layer if needed.
 *
 * @param response - The Response object from a Hiro API fetch
 * @param logger - Optional Logger for emitting the warn event
 * @param path - Optional precomputed pathname (avoids re-parsing response.url)
 * @returns Parsed monthly quota fields (null for any header absent or unparseable)
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

  const remainingMonth = parseIntHeader("x-ratelimit-remaining-stacks-month");
  const limitMonth = parseIntHeader("x-ratelimit-limit-stacks-month");
  const costStacks = parseIntHeader("x-ratelimit-cost-stacks");

  if (
    logger &&
    remainingMonth !== null &&
    limitMonth !== null &&
    limitMonth > 0 &&
    remainingMonth / limitMonth < MONTHLY_QUOTA_WARN_FRACTION
  ) {
    logger.warn("stacksApi.approaching_monthly_quota", {
      path: path ?? extractPath(response.url),
      rlRemainingMonth: remainingMonth,
      rlLimitMonth: limitMonth,
      threshold: MONTHLY_QUOTA_WARN_FRACTION,
    });
  }

  return { remainingMonth, limitMonth, costStacks };
}

/** Per-attempt fetch timeout in milliseconds (default for background/non-sync calls). */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

/**
 * Tighter per-attempt timeout for *synchronous, user/consumer-facing* lookups
 * (profile enrichment, identity/BNS refresh). The 8s default is fine for
 * background work but far too long on a request path whose consumers budget
 * ~3s (e.g. aibtc.news identity-gate): a single hung CF→Hiro call would burn
 * 8s × retries ≈ 16s and blow the caller's budget. Pair this with a reduced
 * retry budget so the worst case stays well under a few seconds. See #939.
 */
export const SYNC_PER_ATTEMPT_TIMEOUT_MS = 3_500;

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
   * Per-attempt fetch timeout in ms (default: {@link PER_ATTEMPT_TIMEOUT_MS} = 8000).
   * Synchronous request-path callers should pass {@link SYNC_PER_ATTEMPT_TIMEOUT_MS}
   * so a hung upstream fails fast instead of exhausting the caller's budget.
   */
  perAttemptTimeoutMs?: number;
  /**
   * Optional Logger; when provided, emits `stacksApi.*` telemetry events
   * (approaching_monthly_quota, retry_budget_exhausted, retrying). Silent
   * when omitted — we do not fall back to `console.*`,
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
    perAttemptTimeoutMs = PER_ATTEMPT_TIMEOUT_MS,
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
      signal: AbortSignal.timeout(perAttemptTimeoutMs),
    };

    try {
      const response = await fetch(url, attemptOptions);

      // Side-effect only: emits stacksApi.approaching_monthly_quota when the
      // logger is present and the monthly remaining drops below the threshold.
      extractRateLimitInfo(response, logger, path);

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
