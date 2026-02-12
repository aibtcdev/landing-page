/**
 * ERC-8004 reputation fetching utilities
 */

import {
  REPUTATION_REGISTRY_CONTRACT,
  STACKS_API_BASE,
  WAD_DECIMALS,
} from "./constants";
import type { ReputationSummary, ReputationFeedbackResponse, ReputationFeedback } from "./types";

// Simple in-memory cache with 5-minute TTL
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Call a read-only function on the reputation registry contract
 */
async function callReadOnly(
  functionName: string,
  args: string[]
): Promise<any> {
  const [contractAddress, contractName] =
    REPUTATION_REGISTRY_CONTRACT.split(".");
  const url = `${STACKS_API_BASE}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: contractAddress,
      arguments: args,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Stacks API call failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data;
}

/**
 * Parse a Clarity value from the API response
 */
function parseClarityValue(result: any): any {
  if (!result || !result.okay) {
    return null;
  }

  const value = result.result;

  // Handle different Clarity types
  if (value.type === "uint") {
    return parseInt(value.value, 10);
  }

  if (value.type === "int") {
    return parseInt(value.value, 10);
  }

  if (value.type === "principal") {
    return value.value;
  }

  if (value.type === "string-utf8" || value.type === "string-ascii") {
    return value.value;
  }

  if (value.type === "bool") {
    return value.value === "true";
  }

  if (value.type === "optional") {
    if (value.value === null || value.value.type === "none") {
      return null;
    }
    return parseClarityValue({ okay: true, result: value.value });
  }

  if (value.type === "response") {
    if (value.value.success) {
      return parseClarityValue({ okay: true, result: value.value.value });
    }
    return null;
  }

  if (value.type === "tuple") {
    const tuple: any = {};
    for (const [key, val] of Object.entries(value.value)) {
      tuple[key] = parseClarityValue({ okay: true, result: val });
    }
    return tuple;
  }

  if (value.type === "list") {
    return value.value.map((item: any) =>
      parseClarityValue({ okay: true, result: item })
    );
  }

  return null;
}

/**
 * Get reputation summary for an agent
 * Returns count and average score (WAD converted to decimal)
 */
export async function getReputationSummary(
  agentId: number
): Promise<ReputationSummary | null> {
  const cacheKey = `summary:${agentId}`;
  const cached = getCached<ReputationSummary>(cacheKey);
  if (cached) return cached;

  try {
    const result = await callReadOnly("get-summary", [`u${agentId}`]);
    const summary = parseClarityValue(result);

    if (!summary || summary.count === 0) {
      return null;
    }

    // Convert WAD value to decimal
    const summaryValue = summary["summary-value"] / Math.pow(10, WAD_DECIMALS);

    const reputationSummary: ReputationSummary = {
      count: summary.count,
      summaryValue,
      summaryValueDecimals: summary["summary-value-decimals"],
    };

    setCache(cacheKey, reputationSummary);
    return reputationSummary;
  } catch (error) {
    console.error("Error fetching reputation summary:", error);
    return null;
  }
}

/**
 * Get all feedback for an agent with pagination
 */
export async function getReputationFeedback(
  agentId: number,
  cursor?: number
): Promise<ReputationFeedbackResponse> {
  const cacheKey = `feedback:${agentId}:${cursor || 0}`;
  const cached = getCached<ReputationFeedbackResponse>(cacheKey);
  if (cached) return cached;

  try {
    // read-all-feedback(agent-id, opt-tag1, opt-tag2, include-revoked, opt-cursor)
    const cursorArg = cursor ? `(some u${cursor})` : "none";
    const result = await callReadOnly("read-all-feedback", [
      `u${agentId}`,
      "none", // opt-tag1
      "none", // opt-tag2
      "false", // include-revoked
      cursorArg,
    ]);

    const response = parseClarityValue(result);

    if (!response || !response.items) {
      return { items: [], cursor: null };
    }

    const items: ReputationFeedback[] = response.items.map((item: any) => ({
      client: item.client,
      index: item.index,
      value: item.value,
      valueDecimals: item["value-decimals"],
      wadValue: item["wad-value"] / Math.pow(10, WAD_DECIMALS),
      tag1: item.tag1,
      tag2: item.tag2,
      isRevoked: item["is-revoked"],
    }));

    const feedbackResponse: ReputationFeedbackResponse = {
      items,
      cursor: response.cursor,
    };

    setCache(cacheKey, feedbackResponse);
    return feedbackResponse;
  } catch (error) {
    console.error("Error fetching reputation feedback:", error);
    return { items: [], cursor: null };
  }
}
