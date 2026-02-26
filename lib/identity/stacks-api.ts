/**
 * Shared Stacks API utilities for read-only contract calls.
 *
 * Uses @stacks/transactions for proper Clarity value serialization
 * and deserialization. The Hiro /v2/contracts/call-read/ endpoint
 * expects hex-encoded Clarity values as arguments and returns hex
 * in the `result` field.
 */

import {
  type ClarityValue,
  serializeCV,
  deserializeCV,
  cvToJSON,
} from "@stacks/transactions";
import { STACKS_API_BASE } from "./constants";
import { stacksApiFetch } from "../stacks-api-fetch";

/** Build headers for Hiro API requests, optionally including an API key. */
export function buildHiroHeaders(hiroApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hiroApiKey) {
    headers["X-Hiro-API-Key"] = hiroApiKey;
  }
  return headers;
}

/**
 * Call a read-only function on a Stacks smart contract.
 *
 * @param contract - Fully-qualified contract identifier (e.g. "SP...address.contract-name")
 * @param functionName - The read-only function to call
 * @param args - ClarityValue objects (will be serialized to hex for the API)
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @returns Parsed JSON representation of the Clarity return value from the Stacks API.
 * @throws Error if the Stacks API request fails (non-2xx HTTP response).
 */
export async function callReadOnly(
  contract: string,
  functionName: string,
  args: ClarityValue[],
  hiroApiKey?: string
): Promise<any> {
  const [contractAddress, contractName] = contract.split(".");
  const url = `${STACKS_API_BASE}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

  // Serialize each ClarityValue to a 0x-prefixed hex string
  const hexArgs = args.map((cv) => `0x${serializeCV(cv)}`);

  const headers = buildHiroHeaders(hiroApiKey);
  headers["Content-Type"] = "application/json";

  const response = await stacksApiFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sender: contractAddress,
      arguments: hexArgs,
    }),
  });

  // Log cf-ray for observability if the final response is still a 429 after retries
  detect429(response);

  if (!response.ok) {
    throw new Error(
      `Stacks API call failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data;
}

/**
 * Parse a Clarity value from the Stacks API response.
 *
 * The API returns { okay: true, result: "0x..." } where result is a
 * hex-encoded Clarity value. We deserialize it and convert to a
 * JSON-friendly representation using cvToJSON from @stacks/transactions.
 */
export function parseClarityValue(apiResponse: any): any {
  if (!apiResponse || apiResponse.okay !== true) {
    return null;
  }

  try {
    const cv = deserializeCV(apiResponse.result);
    const json = cvToJSON(cv);
    return unwrapCvJson(json);
  } catch {
    return null;
  }
}

/**
 * Recursively unwrap cvToJSON output into plain JS values.
 *
 * @stacks/transactions v7 cvToJSON returns typed wrappers with
 * descriptive compound type strings. Examples:
 *   - { type: "uint", value: "5" }
 *   - { type: "(response (tuple ...) UnknownType)", value: {...}, success: true }
 *   - { type: "(optional principal)", value: { type: "principal", value: "SP..." } }
 *   - { type: "(optional none)", value: null }
 *   - { type: "(tuple (count uint) ...)", value: { count: { type: "uint", value: "3" } } }
 *
 * This helper extracts the inner values for easier consumption.
 * Numeric values (uint, int) are returned as strings to preserve
 * full precision — callers decide whether to use Number or BigInt.
 */
function unwrapCvJson(node: any): any {
  if (node === null || node === undefined) return null;

  // cvToJSON wraps values with { type, value } objects
  if (typeof node === "object" && "type" in node) {
    const type: string = node.type;
    const value = node.value;

    // Response: check `success` field (present on response types)
    if ("success" in node) {
      if (node.success) {
        return unwrapCvJson(value);
      }
      return null;
    }

    // --- Compound types first ---
    // These must be checked before simple-type substring matches because
    // compound type strings like "(tuple (cursor (optional none)) (items (list ...)))"
    // contain substrings ("none", "string", "principal") that would incorrectly
    // match simple-type checks.

    // Tuple: value is an object of named fields
    if (type.startsWith("(tuple")) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] = unwrapCvJson(v);
        }
        return out;
      }
      return value;
    }

    // List: value is an array
    if (type.startsWith("(list")) {
      if (Array.isArray(value)) {
        return value.map(unwrapCvJson);
      }
      return value;
    }

    // Optional with value — unwrap the inner value
    if (type.startsWith("(optional")) {
      if (value === null || value === undefined) return null;
      return unwrapCvJson(value);
    }

    // --- Simple types ---

    // None
    if (type === "none") {
      return null;
    }

    // Uint / int — return as string for precision
    if (type === "uint" || type === "int") {
      return value as string;
    }

    // Bool
    if (type === "bool") {
      return value;
    }

    // Principal types
    if (type === "principal" || type.includes("principal")) {
      if (typeof value === "string") return value;
      if (typeof value === "object" && value !== null && "value" in value) {
        return value.value;
      }
      return value;
    }

    // Buffer
    if (type === "buff" || type.startsWith("(buff")) {
      return value;
    }

    // String types
    if (type.includes("string") || type.includes("ascii") || type.includes("utf8")) {
      if (typeof value === "string") return value;
      if (typeof value === "object" && value !== null && "value" in value) {
        return value.value;
      }
      return value;
    }

    // Fallback: try to unwrap value if it looks like a typed node
    if (value !== undefined && value !== null) {
      return unwrapCvJson(value);
    }
  }

  return node;
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
