/**
 * Testnet read-only contract calls for the Legion dashboard.
 *
 * Deliberately separate from `lib/identity/stacks-api.ts` (which is hardcoded to
 * mainnet and sits on the request-critical profile path). This module reuses the
 * shared fetch wrapper and the base-agnostic `parseClarityValue` decoder, and
 * only adds the testnet URL + a small `/v2/info` helper. The Hiro API key is
 * sent via `x-api-key` (Hiro's documented header) to lift the per-IP rate limit.
 */

import { type ClarityValue, serializeCV } from "@stacks/transactions";
import { stacksApiFetch, detect429 } from "../stacks-api-fetch";
import { parseClarityValue } from "../identity/stacks-api";
import { LEGION_API_BASE } from "./constants";
import type { Logger } from "../logging";

const PER_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Hiro auth headers. Hiro's current documented header is `x-api-key`; we also
 * send the legacy `x-hiro-api-key` for compatibility. Without a key the request
 * goes out anonymous and is capped at 50 RPM per IP — which a Worker (shared
 * colo egress IP) blows through instantly, so the key is what makes deployed
 * reads viable.
 */
function legionHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["x-hiro-api-key"] = apiKey;
  }
  return headers;
}

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
  hiroApiKey?: string,
  logger?: Logger,
): Promise<unknown> {
  const [contractAddress, contractName] = contract.split(".");
  const url = `${LEGION_API_BASE}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

  // An authenticated key lifts the per-IP rate limit — important because a
  // Worker shares its colo egress IP with other tenants hitting Hiro.
  const headers = legionHeaders(hiroApiKey);
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
    // Runs on the cron, not a user request, so it can afford to back off and
    // retry transient 429s (the shared colo IP occasionally trips Hiro's limit
    // even with a key).
    { retries: 2, retries429: 3, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS, logger },
  );

  detect429(response, logger);

  if (!response.ok) {
    throw new Error(
      `Legion read ${functionName} failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseClarityValue(await response.json(), logger);
}

export interface ContractTx {
  txid: string;
  functionName: string;
  /** Caller principal. */
  sender: string;
  /** Decoded function-call argument reprs, e.g. ["u4", "true"]. */
  argReprs: string[];
}

/** Parse a Clarity uint repr like "u4" into a number, or null. */
export function parseUintRepr(repr: string | undefined): number | null {
  if (typeof repr !== "string" || !repr.startsWith("u")) return null;
  const n = Number(repr.slice(1));
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch a contract's recent transaction history (newest first), decoding the
 * function name, sender, and first uint arg of each contract-call. Used to
 * recover vote txids — the on-chain vote record itself doesn't store them.
 *
 * Only `tx_status === "success"` txs are returned. A reverted call (e.g. a
 * `vote` that aborts with `(err ...)`) changes no on-chain state, so counting
 * it would render a phantom vote with no backing vote-record (amount 0). The
 * endpoint returns confirmed txs of every status, so we filter here.
 *
 * Bounded by `maxTxs`; if the contract has more than that, the oldest are not
 * returned (logged, never silently). For the Legion this only matters for
 * in-flight proposals, whose votes are the newest txs, so the cap is ample.
 */
export async function getContractTransactions(
  contractId: string,
  apiKey?: string,
  logger?: Logger,
  maxTxs = 200,
): Promise<ContractTx[]> {
  const out: ContractTx[] = [];
  const pageSize = 50;

  for (let offset = 0; offset < maxTxs; offset += pageSize) {
    let data: { results?: unknown[]; total?: number } | null = null;
    try {
      const response = await stacksApiFetch(
        `${LEGION_API_BASE}/extended/v1/address/${contractId}/transactions?limit=${pageSize}&offset=${offset}`,
        { method: "GET", headers: legionHeaders(apiKey) },
        { retries: 1, retries429: 1, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS, logger },
      );
      if (!response.ok) break;
      data = await response.json();
    } catch {
      break;
    }

    const results = data?.results ?? [];
    for (const item of results) {
      const tx = ((item as { tx?: unknown }).tx ?? item) as {
        tx_id?: string;
        tx_status?: string;
        sender_address?: string;
        contract_call?: { function_name?: string; function_args?: { repr?: string }[] };
      };
      const cc = tx.contract_call;
      if (!cc?.function_name || !tx.tx_id) continue;
      if (tx.tx_status !== "success") continue; // skip reverted/aborted calls
      out.push({
        txid: tx.tx_id,
        functionName: cc.function_name,
        sender: tx.sender_address ?? "",
        argReprs: (cc.function_args ?? []).map((a) => a.repr ?? ""),
      });
    }

    if (results.length < pageSize) break; // last page
    if (data?.total != null && offset + pageSize >= data.total) break;
    if (offset + pageSize >= maxTxs && (data?.total ?? 0) > maxTxs) {
      logger?.warn?.("legion.contract_tx_truncated", { contractId, cap: maxTxs, total: data?.total });
    }
  }

  return out;
}

/**
 * Fetch a contract's `print` events (smart-contract logs), newest first, and
 * decode each payload into a plain JS value via `parseClarityValue`. Used to
 * enumerate provider Legions — the `Providers` map has no on-chain "list all",
 * so we scan `register` print events and dedupe (brief §3 option (a)).
 *
 * Bounded by `maxEvents`; non-`smart_contract_log` events are skipped. Returns
 * `[]` (never throws) so a build degrades to a partial snapshot.
 */
export async function getContractEvents(
  contractId: string,
  apiKey?: string,
  logger?: Logger,
  maxEvents = 200,
): Promise<unknown[]> {
  const out: unknown[] = [];
  const pageSize = 50;

  for (let offset = 0; offset < maxEvents; offset += pageSize) {
    let data: { results?: unknown[] } | null = null;
    try {
      const response = await stacksApiFetch(
        `${LEGION_API_BASE}/extended/v1/contract/${contractId}/events?limit=${pageSize}&offset=${offset}`,
        { method: "GET", headers: legionHeaders(apiKey) },
        { retries: 1, retries429: 1, perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS, logger },
      );
      if (!response.ok) break;
      data = await response.json();
    } catch {
      break;
    }

    const results = data?.results ?? [];
    for (const item of results) {
      const ev = item as {
        event_type?: string;
        contract_log?: { value?: { hex?: string } };
      };
      if (ev.event_type !== "smart_contract_log") continue;
      const hex = ev.contract_log?.value?.hex;
      if (!hex) continue;
      const decoded = parseClarityValue({ okay: true, result: hex }, logger);
      if (decoded != null) out.push(decoded);
    }

    if (results.length < pageSize) break; // last page
  }

  return out;
}

/** Current Stacks testnet tip height, or null if /v2/info is unreachable. */
export async function getTestnetTipHeight(
  hiroApiKey?: string,
  logger?: Logger,
): Promise<number | null> {
  try {
    const response = await stacksApiFetch(
      `${LEGION_API_BASE}/v2/info`,
      { method: "GET", headers: legionHeaders(hiroApiKey) },
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
