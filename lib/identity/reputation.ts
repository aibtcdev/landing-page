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
import type { ReputationSummary, ReputationFeedbackResponse, ReputationFeedback } from "./types";
import type { Logger } from "../logging";

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
 * Get reputation summary for an agent
 * Returns count and average score (WAD converted to decimal)
 */
export async function getReputationSummary(
  agentId: number,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<ReputationSummary | null> {
  const cacheKey = `summary:${agentId}`;
  const cached = await getCachedReputation<ReputationSummary>(cacheKey, kv, logger);
  if (cached.hit) return cached.value;

  // Circuit-breaker pre-check: if Hiro budget is exhausted, skip callReadOnly
  // and write a per-agentId negative cache so this key also short-circuits on
  // subsequent requests. Log at warn — the breaker being open is expected
  // during budget-exhaustion windows, not an actionable error.
  if (await isReputationCircuitOpen(kv, logger)) {
    logger?.warn("reputation.summary_circuit_open", { agentId });
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    return null;
  }

  try {
    const result = await callReadOnly(REPUTATION_REGISTRY_CONTRACT, "get-summary", [uintCV(agentId)], hiroApiKey, logger);
    const summary = parseClarityValue(result, logger);

    if (!summary || Number(summary.count) === 0) {
      await setCachedReputation(cacheKey, null, kv, logger);
      return null;
    }

    // Convert WAD value to decimal using bigint for precision
    const summaryValue = wadToNumber(summary["summary-value"]);

    const reputationSummary: ReputationSummary = {
      count: Number(summary.count),
      summaryValue,
      summaryValueDecimals: Number(summary["summary-value-decimals"]),
    };

    await setCachedReputation(cacheKey, reputationSummary, kv, logger);
    return reputationSummary;
  } catch (error) {
    // Open the shared circuit breaker so subsequent calls for ANY agentId
    // skip callReadOnly for the next 60s. This stops the error storm when
    // Hiro budget is exhausted — each retry would otherwise trigger up to 3
    // Hiro requests (1 + 2 retries) before hitting its per-key negative cache.
    await setReputationCircuitOpen(kv, logger);
    // Downgrade from error to warn: budget exhaustion is an expected upstream
    // condition, not a local bug. Error-level events were driving the
    // reputation.summary_fetch_error alert storm (56–441/day).
    logger?.warn("reputation.summary_fetch_error", {
      agentId,
      error: String(error),
    });
    // Mirrors the setCachedBnsLookupFailed / setCachedIdentityLookupFailed
    // pattern from kv-cache.ts: write a 60s negative cache and return null
    // silently. Throwing here would create an asymmetry — the first request
    // within the failure window returns 500, subsequent requests within 60s
    // return the cached null as 200 — surfacing inconsistent behavior to
    // the same polling client. Returning null on both calls matches the
    // BNS/identity helpers' behavior and bounds Hiro retries to 1/60s.
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    return null;
  }
}

/**
 * Get all feedback for an agent with pagination
 */
export async function getReputationFeedback(
  agentId: number,
  cursor?: number,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<ReputationFeedbackResponse> {
  const cacheKey = `feedback:${agentId}:${cursor || 0}`;
  const cached = await getCachedReputation<ReputationFeedbackResponse>(cacheKey, kv, logger);
  if (cached.hit) return cached.value ?? { items: [], cursor: null };

  // Circuit-breaker pre-check: same semantics as getReputationSummary.
  // If the shared breaker is open, skip callReadOnly and write a per-key
  // negative cache so this feedback key also short-circuits.
  if (await isReputationCircuitOpen(kv, logger)) {
    logger?.warn("reputation.feedback_circuit_open", {
      agentId,
      cursor: cursor ?? null,
    });
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    return { items: [], cursor: null };
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
      const empty: ReputationFeedbackResponse = { items: [], cursor: null };
      await setCachedReputation(cacheKey, empty, kv, logger);
      return empty;
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
    return feedbackResponse;
  } catch (error) {
    // Open the shared circuit breaker so subsequent calls for ANY agentId
    // skip callReadOnly for the next 60s — same rationale as getReputationSummary.
    await setReputationCircuitOpen(kv, logger);
    // Downgrade from error to warn: budget exhaustion is an expected upstream
    // condition during the competition sweep window.
    logger?.warn("reputation.feedback_fetch_error", {
      agentId,
      cursor: cursor ?? null,
      error: String(error),
    });
    // Same 60s negative-cache treatment as getReputationSummary: break the
    // polling-storm amplification on transient Hiro errors (TimeoutError,
    // 5xx). Returns an empty feedback page silently — matches BNS/identity
    // behavior where lookup-failed and confirmed-negative both surface as
    // null/empty to callers, distinguished only by TTL.
    await setCachedReputationLookupFailed(cacheKey, kv, logger);
    return { items: [], cursor: null };
  }
}
