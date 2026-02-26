/**
 * Shared Stacks API fetch wrapper with exponential backoff retry.
 *
 * Provides resilience for transient 429 (rate limit) and 5xx (server error)
 * responses from the Hiro Stacks API. Used by callReadOnly() in
 * lib/identity/stacks-api.ts and verifyTxidPayment() in lib/inbox/x402-verify.ts.
 *
 * Retry strategy:
 * - 3 attempts (initial + 2 retries)
 * - Delays: 500ms, 1000ms, 2000ms (doubles each attempt)
 * - Respects Retry-After header on 429 (capped at 10s)
 * - Per-attempt timeout: 8 seconds
 * - Returns the final Response after all retries — callers check status
 */

/** Per-attempt fetch timeout in milliseconds. */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

/** Maximum delay from Retry-After header (milliseconds). */
const MAX_RETRY_AFTER_MS = 10_000;

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
function parseRetryAfterMs(response: Response): number | null {
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
 * If a Retry-After header is present on a 429, that delay takes precedence
 * over the exponential backoff (capped at MAX_RETRY_AFTER_MS).
 *
 * On successful response (2xx or 4xx that is not retryable), returns immediately.
 * After all retries are exhausted, returns the last Response so the caller
 * can inspect status and body.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (method, headers, body). Signal is injected per-attempt.
 * @param retries - Total number of attempts (default: 3)
 * @param baseDelayMs - Base delay for exponential backoff in ms (default: 500)
 * @returns The final Response object
 * @throws Only on network-level errors (DNS failure, connection refused) after all retries
 */
export async function stacksApiFetch(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelayMs = 500
): Promise<Response> {
  const tag = "[stacksApiFetch]";

  for (let attempt = 0; attempt < retries; attempt++) {
    const attemptOptions: RequestInit = {
      ...options,
      signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
    };
    const isLastAttempt = attempt === retries - 1;

    try {
      const response = await fetch(url, attemptOptions);

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      if (isLastAttempt) {
        console.warn(`${tag} All ${retries} attempts exhausted for ${url} (status: ${response.status})`);
        return response;
      }

      // Prefer Retry-After header on 429, otherwise exponential backoff
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response) : null;
      const delayMs = retryAfterMs ?? baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `${tag} ${response.status} on ${url}, attempt ${attempt + 1}/${retries}, retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    } catch (error) {
      if (isLastAttempt) {
        console.warn(`${tag} All ${retries} attempts exhausted for ${url} (${String(error)})`);
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `${tag} Network error on ${url}, attempt ${attempt + 1}/${retries}, retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  // Unreachable -- loop always returns or throws on final attempt
  throw new Error(`${tag} Unexpected: retry loop exited without return`);
}
