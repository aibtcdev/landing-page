/**
 * Testnet read-only contract calls for the Legion dashboard.
 *
 * Deliberately separate from `lib/identity/stacks-api.ts` (which is hardcoded to
 * mainnet and sits on the request-critical profile path). This module reuses the
 * shared fetch wrapper and the base-agnostic `parseClarityValue` decoder, and
 * only adds the testnet URL + a small `/v2/info` helper. No key is sent —
 * testnet read-only calls are public.
 */

import { type ClarityValue, serializeCV } from "@stacks/transactions";
import { stacksApiFetch, buildHiroHeaders, detect429 } from "../stacks-api-fetch";
import { parseClarityValue } from "../identity/stacks-api";
import { LEGION_API_BASE } from "./constants";
import type { Logger } from "../logging";

const PER_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Call a read-only function on a testnet contract and return the unwrapped
 * Clarity value (uint/int as strings, optionals unwrapped to their inner value
 * or null, tuples as plain objects). Throws on non-2xx so callers can record
 * the failure and fall back.
 */
export async function legionReadOnly(
  contract: string,
  functionName: string,
  args: ClarityValue[] = [],
  logger?: Logger,
): Promise<unknown> {
  const [contractAddress, contractName] = contract.split(".");
  const url = `${LEGION_API_BASE}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

  const headers = buildHiroHeaders();
  headers["Content-Type"] = "application/json";

  const response = await stacksApiFetch(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        sender: contractAddress,
        arguments: args.map((cv) => `0x${serializeCV(cv)}`),
      }),
    },
    { retries: 1, retries429: 1, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS, logger },
  );

  detect429(response, logger);

  if (!response.ok) {
    throw new Error(
      `Legion read ${functionName} failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseClarityValue(await response.json(), logger);
}

/** Current Stacks testnet tip height, or null if /v2/info is unreachable. */
export async function getTestnetTipHeight(logger?: Logger): Promise<number | null> {
  try {
    const response = await stacksApiFetch(
      `${LEGION_API_BASE}/v2/info`,
      { method: "GET" },
      { retries: 1, retries429: 1, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS, logger },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { stacks_tip_height?: number };
    const height = Number(data?.stacks_tip_height);
    return Number.isFinite(height) ? height : null;
  } catch {
    return null;
  }
}
