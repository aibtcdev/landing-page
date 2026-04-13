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
 */

/** Build headers for Hiro API requests, optionally including an API key. */
export function buildHiroHeaders(hiroApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hiroApiKey) {
    headers["X-Hiro-API-Key"] = hiroApiKey;
  }
  return headers;
}

/**
 * Detect 429 rate limit responses and log cf-ray for observability.
 *
 * @returns Object with isRateLimited flag for caller branching
 */
export function detect429(response: Response): {
  isRateLimited: boolean;
} {
  const isRateLimited = response.status === 429;

  if (isRateLimited) {
    const cfRay = response.headers.get("cf-ray");
    console.warn(
      `Rate limit detected (429) on ${response.url}${cfRay ? ` [cf-ray: ${cfRay}]` : ""}`
    );
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
 * Emits a warn-level log when the remaining budget drops below
 * RATE_LIMIT_WARN_THRESHOLD (50) to alert operators before key exhaustion.
 *
 * @param response - The Response object from a Hiro API fetch
 * @returns Parsed rate limit fields (null for any header that is absent or unparseable)
 */
export function extractRateLimitInfo(response: Response): RateLimitInfo {
  const tag = "[stacksApiFetch]";

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

  if (remaining !== null && remaining < RATE_LIMIT_WARN_THRESHOLD) {
    console.warn(
      `${tag} Hiro API key approaching rate limit: ${remaining}/${limit ?? "?"} remaining` +
        (reset !== null ? ` (resets in ${reset}s)` : "")
    );
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

/**
 * Fetch a Stacks API URL with exponential backoff retry on 429/5xx responses.
 *
 * Each attempt uses an independent AbortSignal with a per-attempt timeout.
 *
 * 429 rate-limit responses use a separate retry budget (retries429, default 5)
 * with a longer base delay (1s, 2s, 4s, 8s, 16s) to absorb burst rate limits.
 * The Retry-After header from Hiro takes precedence over computed backoff (capped at 30s).
 *
 * 5xx server errors use the standard retry budget (retries, default 3) with
 * 500ms base delay (500ms, 1s, 2s).
 *
 * On successful response (2xx or non-retryable 4xx), returns immediately.
 * After all retries for a given error type are exhausted, returns the last
 * Response so the caller can inspect status and body.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (method, headers, body). Signal is injected per-attempt.
 * @param retries - Max attempts for 5xx errors (default: 3)
 * @param baseDelayMs - Base delay for 5xx exponential backoff in ms (default: 500)
 * @param retries429 - Max attempts for 429 rate-limit errors (default: RATE_LIMIT_RETRIES = 5)
 * @returns The final Response object
 * @throws Only on network-level errors (DNS failure, connection refused) after all retries
 */
export async function stacksApiFetch(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelayMs = 500,
  retries429 = RATE_LIMIT_RETRIES
): Promise<Response> {
  const tag = "[stacksApiFetch]";

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

      // Extract rate limit info on every response for observability (warns when low)
      const rl = extractRateLimitInfo(response);

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      const is429 = response.status === 429;

      // Build a compact rate limit suffix for retry log messages
      const rlSuffix =
        rl.remaining !== null
          ? ` [rl: ${rl.remaining}/${rl.limit ?? "?"} remaining]`
          : "";

      if (is429) {
        attempts429++;
        if (attempts429 >= retries429) {
          // Exhausted 429 retry budget — return final response to caller
          console.warn(
            `${tag} 429 retry budget exhausted (${retries429} attempts) for ${url}${rlSuffix}`
          );
          return response;
        }

        // Prefer Retry-After header, otherwise exponential backoff with 1s base
        const retryAfterMs =
          parseRetryAfterMs(response) ??
          RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempts429 - 1);
        const delayMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
        console.warn(
          `${tag} 429 on ${url}, attempt ${attempts429}/${retries429}, retrying in ${delayMs}ms${rlSuffix}`
        );
        await sleep(delayMs);
      } else {
        // 5xx error
        attempts5xx++;
        if (attempts5xx >= retries) {
          console.warn(
            `${tag} 5xx retry budget exhausted (${retries} attempts) for ${url} (status: ${response.status})${rlSuffix}`
          );
          return response;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
        console.warn(
          `${tag} ${response.status} on ${url}, attempt ${attempts5xx}/${retries}, retrying in ${delayMs}ms${rlSuffix}`
        );
        await sleep(delayMs);
      }
    } catch (error) {
      // Network-level error — counts against the 5xx budget
      attempts5xx++;
      if (attempts5xx >= retries) {
        console.warn(
          `${tag} Network error budget exhausted (${retries} attempts) for ${url} (${String(error)})`
        );
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempts5xx - 1);
      console.warn(
        `${tag} Network error on ${url}, attempt ${attempts5xx}/${retries}, retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  // Unreachable -- loop always returns or throws when a budget is exhausted
  throw new Error(`${tag} Unexpected: retry loop exited without return`);
}
