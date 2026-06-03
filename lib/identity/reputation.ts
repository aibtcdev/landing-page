/**
 * ERC-8004 reputation fetching utilities
 */

import { uintCV, noneCV, falseCV, someCV } from "@stacks/transactions";
import { REPUTATION_REGISTRY_CONTRACT } from "./constants";
import { callReadOnly, parseClarityValue } from "./stacks-api";
import {
  getCachedReputation,
  setCachedReputation,
  setCachedReputationLookupFailed,
  isReputationCircuitOpen,
  setReputationCircuitOpen,
} from "./kv-cache";
import type { ReputationSummary, ReputationFeedbackResponse, ReputationFeedback, ReputationResult } from "./types";
import type { Logger } from "../logging";

/**
 * Classify a caught error as an upstream Hiro condition vs. a local processing bug.
 *
 * The global circuit breaker should ONLY open for upstream Hiro conditions:
 *   - HTTP 429 rate-limit (error message: "Stacks API call failed: 429 ...")
 *   - HTTP 5xx server error (error message: "Stacks API call failed: 5xx ...")
 *   - Network / timeout error (AbortError, TypeError from DNS/TCP failure,
 *     or any error whose message mentions "timeout" / "aborted" / "network")
 *
 * Local bugs — e.g. BigInt() throw on unexpected Clarity response shape, or
 * any other parse/transform error that occurs AFTER a successful HTTP response
 * — must NOT open the global breaker. Opening it on local bugs masks real
 * defects and suppresses lookups for all agentIds for 60s.
 *
 * Detection relies on the error message produced by callReadOnly:
 *   `throw new Error(\`Stacks API call failed: ${response.status} ${response.statusText}\`)`
 * and on the network-level errors re-thrown by stacksApiFetch after retry
 * budget exhaustion (AbortError from per-attempt timeout, or TypeError/Error
 * from DNS/TCP failure).
 */
function isUpstreamHiroError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;

    // HTTP-level failures from callReadOnly (e.g. "Stacks API call failed: 429 Too Many Requests")
    const httpMatch = msg.match(/Stacks API call failed:\s*(\d+)/);
    if (httpMatch) {
      const status = parseInt(httpMatch[1], 10);
      // 429 (rate-limit/budget-exhausted) or any 5xx (server error)
      return status === 429 || (status >= 500 && status < 600);
    }

    // Network / timeout errors re-thrown by stacksApiFetch after budget exhaustion.
    // AbortError is thrown when AbortSignal.timeout() fires (per-attempt timeout).
    // "fetch failed" is the Node.js/Workers fetch() message on DNS/TCP failures.
    // "The operation was aborted" covers AbortError messages in some runtimes.
    //
    // We intentionally do NOT classify all TypeErrors as upstream — a TypeError
    // from JS runtime (e.g. BigInt() on an invalid string, accessing .property
    // on undefined) is a local processing bug and must NOT open the global breaker.
    if (
      error.name === "AbortError" ||
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("the operation was aborted") ||
      msg.toLowerCase() === "fetch failed" ||
      msg.toLowerCase().startsWith("fetch failed")
    ) {
      return true;
    }

    return false;
  }

  // Non-Error throws (unlikely in this codebase, but safe to treat as local)
  return false;
}

/**
 * WAD divisor: 10^18 as a BigInt.
 * Pre-computed as a string literal to avoid BigInt exponentiation,
 * which requires a higher TS target than ES2017.
 */
const WAD_DIVISOR = BigInt("1000000000000000000"); // 10^18

/** Convert a WAD-scaled string to a display-friendly number using bigint math. */
function wadToNumber(wadStr: string): number {
  const wad = BigInt(wadStr);
  // Keep 2 extra digits for rounding, then convert to Number
  const scaled = (wad * BigInt(100)) / WAD_DIVISOR;
  return Number(scaled) / 100;
}

/**
 * Get reputation summary for an agent.
 * Returns count and average score (WAD converted to decimal).
 *
 * The returned `ReputationResult` carries a `transient` flag:
 *  - `false` — authoritative on-chain result (or confirmed empty). Safe to
 *    edge-cache for the full TTL.
 *  - `true` — transient fallback (circuit breaker open or Hiro error). The
 *    caller MUST NOT edge-cache this response; it should set `no-store` so a
 *    fake empty reputation is never pinned for up to 5 minutes after recovery.
 */
export async function getReputationSummary(
  agentId: number,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<ReputationResult<ReputationSummary | null>> {
  const cacheKey = `summary:${agentId}`;
  const cached = await getCachedReputation<ReputationSummary>(cacheKey, kv, logger);
  // A KV cache hit is always authoritative: it was written either from a
  // confirmed on-chain lookup (positive/empty) or a previous 60s lookup-failed
  // entry. Either way it is NOT a fresh transient fallback, so transient=false.
  if (cached.hit) return { transient: false, value: cached.value };

  // Circuit-breaker pre-check: if Hiro budget is exhausted, skip callReadOnly.
  // Do NOT write a per-agentId negative cache here — the shared breaker already
  // gates all subsequent calls for 60s, and writing a per-agent KV entry would
  // pollute the cache with a transient fallback that looks like an authoritative
  // "no reputation" result. Log at warn — the breaker being open is expected
  // during budget-exhaustion windows, not an actionable error.
  if (await isReputationCircuitOpen(kv, logger)) {
    logger?.warn("reputation.summary_circuit_open", { agentId });
    return { transient: true, value: null };
  }

  try {
    const result = await callReadOnly(REPUTATION_REGISTRY_CONTRACT, "get-summary", [uintCV(agentId)], hiroApiKey, logger);
    const summary = parseClarityValue(result, logger);

    if (!summary || Number(summary.count) === 0) {
      // Confirmed on-chain empty: cache authoritatively and mark non-transient.
      await setCachedReputation(cacheKey, null, kv, logger);
      return { transient: false, value: null };
    }

    // Convert WAD value to decimal using bigint for precision
    const summaryValue = wadToNumber(summary["summary-value"]);

    const reputationSummary: ReputationSummary = {
      count: Number(summary.count),
      summaryValue,
      summaryValueDecimals: Number(summary["summary-value-decimals"]),
    };

    await setCachedReputation(cacheKey, reputationSummary, kv, logger);
    return { transient: false, value: reputationSummary };
  } catch (error) {
    if (isUpstreamHiroError(error)) {
      // Upstream Hiro condition (HTTP 429 / 5xx / network timeout): open the
      // shared circuit breaker so subsequent calls for ANY agentId skip
      // callReadOnly for the next 60s. This stops the error storm when Hiro
      // budget is exhausted. Log at warn — budget exhaustion is an expected
      // upstream condition, not a local bug. Error-level events were driving
      // the reputation.summary_fetch_error alert storm (56–441/day).
      await setReputationCircuitOpen(kv, logger);
      logger?.warn("reputation.summary_fetch_error", {
        agentId,
        error: String(error),
        upstream: true,
      });
    } else {
      // Local processing error (e.g. BigInt() on unexpected Clarity shape,
      // parse bug). Do NOT open the global breaker — this is scoped to this
      // one agentId and must not suppress lookups for other agents. Log at
      // error so the defect is visible and actionable.
      logger?.error("reputation.summary_parse_error", {
        agentId,
        error: String(error),
        upstream: false,
      });
    }
    // Write a 60s per-agentId negative cache so this specific key short-circuits
    // on subsequent requests within the breaker window (bounds Hiro retries to
    // 1/60s on per-key recovery even if the shared breaker already healed).
    // This is a lookup-failed entry, not an authoritative empty — it expires
    // in 60s and does not masquerade as "confirmed no reputation."
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    // Transient: the caller must not edge-cache this as an authoritative result.
    return { transient: true, value: null };
  }
}

/**
 * Get all feedback for an agent with pagination.
 *
 * The returned `ReputationResult` carries a `transient` flag with the same
 * semantics as `getReputationSummary`: `true` means the caller must not
 * edge-cache the response.
 */
export async function getReputationFeedback(
  agentId: number,
  cursor?: number,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<ReputationResult<ReputationFeedbackResponse>> {
  const cacheKey = `feedback:${agentId}:${cursor || 0}`;
  const cached = await getCachedReputation<ReputationFeedbackResponse>(cacheKey, kv, logger);
  // KV cache hit is authoritative — not a fresh transient fallback.
  if (cached.hit) return { transient: false, value: cached.value ?? { items: [], cursor: null } };

  // Circuit-breaker pre-check: same semantics as getReputationSummary.
  // Do NOT write a per-key negative cache for a breaker-open fallback — same
  // rationale as getReputationSummary: avoids poisoning the per-agent cache
  // with a transient result that looks authoritative to later callers.
  if (await isReputationCircuitOpen(kv, logger)) {
    logger?.warn("reputation.feedback_circuit_open", {
      agentId,
      cursor: cursor ?? null,
    });
    return { transient: true, value: { items: [], cursor: null } };
  }

  try {
    // read-all-feedback(agent-id, opt-tag1, opt-tag2, include-revoked, opt-cursor)
    const cursorArg = cursor !== undefined ? someCV(uintCV(cursor)) : noneCV();
    const result = await callReadOnly(REPUTATION_REGISTRY_CONTRACT, "read-all-feedback", [
      uintCV(agentId),
      noneCV(), // opt-tag1
      noneCV(), // opt-tag2
      falseCV(), // include-revoked
      cursorArg,
    ], hiroApiKey, logger);

    const response = parseClarityValue(result, logger);

    if (!response || !response.items) {
      // Confirmed on-chain empty: cache authoritatively.
      const empty: ReputationFeedbackResponse = { items: [], cursor: null };
      await setCachedReputation(cacheKey, empty, kv, logger);
      return { transient: false, value: empty };
    }

    const items: ReputationFeedback[] = response.items.map((item: any) => ({
      client: item.client,
      index: Number(item.index),
      value: Number(item.value),
      valueDecimals: Number(item["value-decimals"]),
      wadValue: wadToNumber(item["wad-value"]),
      tag1: item.tag1,
      tag2: item.tag2,
      isRevoked: item["is-revoked"],
    }));

    const feedbackResponse: ReputationFeedbackResponse = {
      items,
      cursor: response.cursor !== null ? Number(response.cursor) : null,
    };

    await setCachedReputation(cacheKey, feedbackResponse, kv, logger);
    return { transient: false, value: feedbackResponse };
  } catch (error) {
    if (isUpstreamHiroError(error)) {
      // Upstream Hiro condition (HTTP 429 / 5xx / network timeout): open the
      // shared circuit breaker — same rationale as getReputationSummary.
      // Log at warn: budget exhaustion is expected during the competition sweep
      // window, not an actionable local defect.
      await setReputationCircuitOpen(kv, logger);
      logger?.warn("reputation.feedback_fetch_error", {
        agentId,
        cursor: cursor ?? null,
        error: String(error),
        upstream: true,
      });
    } else {
      // Local processing error (e.g. unexpected item shape in map(), BigInt()
      // throw, etc.). Do NOT open the global breaker — this is scoped to this
      // one agentId/cursor pair and must not suppress lookups for other agents.
      // Log at error so the defect is visible and actionable.
      logger?.error("reputation.feedback_parse_error", {
        agentId,
        cursor: cursor ?? null,
        error: String(error),
        upstream: false,
      });
    }
    // Write a 60s per-key negative cache (lookup-failed, not authoritative empty)
    // to bound Hiro retries to 1/60s on per-key recovery.
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    // Transient: the caller must not edge-cache this.
    return { transient: true, value: { items: [], cursor: null } };
  }
}
