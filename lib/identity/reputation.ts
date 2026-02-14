/**
 * ERC-8004 reputation fetching utilities
 */

import { uintCV, noneCV, falseCV, someCV } from "@stacks/transactions";
import { REPUTATION_REGISTRY_CONTRACT } from "./constants";
import { callReadOnly, parseClarityValue } from "./stacks-api";
import { getCachedReputation, setCachedReputation } from "./kv-cache";
import type { ReputationSummary, ReputationFeedbackResponse, ReputationFeedback } from "./types";

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
  kv?: KVNamespace
): Promise<ReputationSummary | null> {
  const cacheKey = `summary:${agentId}`;
  const cached = await getCachedReputation<ReputationSummary>(cacheKey, kv);
  if (cached) return cached;

  try {
    const result = await callReadOnly(REPUTATION_REGISTRY_CONTRACT, "get-summary", [uintCV(agentId)], hiroApiKey);
    const summary = parseClarityValue(result);

    if (!summary || Number(summary.count) === 0) {
      return null;
    }

    // Convert WAD value to decimal using bigint for precision
    const summaryValue = wadToNumber(summary["summary-value"]);

    const reputationSummary: ReputationSummary = {
      count: Number(summary.count),
      summaryValue,
      summaryValueDecimals: Number(summary["summary-value-decimals"]),
    };

    await setCachedReputation(cacheKey, reputationSummary, kv);
    return reputationSummary;
  } catch (error) {
    console.error("Error fetching reputation summary:", error);
    throw error;
  }
}

/**
 * Get all feedback for an agent with pagination
 */
export async function getReputationFeedback(
  agentId: number,
  cursor?: number,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<ReputationFeedbackResponse> {
  const cacheKey = `feedback:${agentId}:${cursor || 0}`;
  const cached = await getCachedReputation<ReputationFeedbackResponse>(cacheKey, kv);
  if (cached) return cached;

  try {
    // read-all-feedback(agent-id, opt-tag1, opt-tag2, include-revoked, opt-cursor)
    const cursorArg = cursor !== undefined ? someCV(uintCV(cursor)) : noneCV();
    const result = await callReadOnly(REPUTATION_REGISTRY_CONTRACT, "read-all-feedback", [
      uintCV(agentId),
      noneCV(), // opt-tag1
      noneCV(), // opt-tag2
      falseCV(), // include-revoked
      cursorArg,
    ], hiroApiKey);

    const response = parseClarityValue(result);

    if (!response || !response.items) {
      return { items: [], cursor: null };
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

    await setCachedReputation(cacheKey, feedbackResponse, kv);
    return feedbackResponse;
  } catch (error) {
    console.error("Error fetching reputation feedback:", error);
    throw error;
  }
}
