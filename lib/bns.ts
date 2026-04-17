import {
  deserializeCV,
  principalCV,
  serializeCV,
  cvToJSON,
} from "@stacks/transactions";
import { hexToBytes, bytesToUtf8 } from "@stacks/common";
import {
  getCachedBnsName,
  setCachedBnsName,
  setCachedBnsNegative,
  setCachedBnsLookupFailed,
  setCachedBnsContractError,
  BNS_NONE_SENTINEL,
  type LookupOutcomeState,
} from "./identity/kv-cache";
import { buildHiroHeaders } from "./identity/stacks-api";
import { stacksApiFetch } from "./stacks-api-fetch";
import { STACKS_API_BASE } from "./identity/constants";
import type { Logger } from "./logging";

const BNS_V2_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BNS_V2_NAME = "BNS-V2";

// BNS-V2 error code returned by `get-primary` when the address has no
// primary name. Treated as an authoritative "no name" signal and cached
// with the confirmed-negative (7d) TTL.
const BNS_ERR_NO_PRIMARY_NAME = "131";

/**
 * Tri-state BNS lookup outcome.
 *
 * - `"positive"` — Hiro returned a name; `name` is set.
 * - `"confirmed-negative"` — Hiro returned `(ok none)`. Authoritative "no name".
 * - `"lookup-failed"` — transient upstream error (429/5xx/timeout/parse) or
 *   contract-reported error. We don't know whether the address has a name.
 *
 * Callers that mirror lookup results into persistent storage (e.g. the
 * refresh endpoint) should skip the write on `"lookup-failed"` — overwriting
 * a verified `bnsName` with `null` during a Hiro incident would corrupt the
 * AgentRecord.
 */
export type BnsLookupOutcome =
  | { state: "positive"; name: string }
  | { state: "confirmed-negative"; name: null }
  | { state: "lookup-failed"; name: null };

/**
 * Internal: run the BNS-V2 `get-primary` lookup and return the tri-state
 * outcome. Populates the KV cache with the appropriate TTL for each branch.
 *
 * Use {@link lookupBnsName} for callers that only need `string | null`.
 */
export async function lookupBnsNameWithOutcome(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<BnsLookupOutcome> {
  const cached = await getCachedBnsName(stxAddress, kv, logger);
  if (cached === BNS_NONE_SENTINEL) {
    // We can't tell from the cache alone whether this was confirmed-negative
    // or lookup-failed (both write NONE_SENTINEL, only TTL differs). Treat
    // any cached NONE_SENTINEL as confirmed-negative for return-type purposes
    // — callers that care about the distinction should bust the cache first.
    return { state: "confirmed-negative", name: null };
  }
  if (cached) return { state: "positive", name: cached };

  try {
    const principal = principalCV(stxAddress);
    const serialized = serializeCV(principal);

    const headers = buildHiroHeaders(hiroApiKey);
    headers["Content-Type"] = "application/json";

    // BNS lookup runs on request paths (register, verify, SSR). Use a reduced
    // retry budget so a degraded Hiro cannot block requests for tens of seconds.
    const res = await stacksApiFetch(
      `${STACKS_API_BASE}/v2/contracts/call-read/${BNS_V2_CONTRACT}/${BNS_V2_NAME}/get-primary`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          sender: stxAddress,
          arguments: [`0x${serialized}`],
        }),
      },
      { retries: 2, retries429: 1, logger }
    );

    if (!res.ok) {
      logger?.warn("bns.lookup_upstream_error", {
        stxAddress,
        status: res.status,
      });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    const data = (await res.json()) as { okay: boolean; result: string };
    if (!data.okay) {
      // Contract-reported error. For BNS V2 `get-primary` against a valid
      // principal this branch is practically unreachable — when it does fire
      // it's usually deterministic (malformed principal), so use the 5-min
      // contract-error TTL rather than the 60s lookup-failed TTL. Still
      // classified as `lookup-failed` so callers that mirror to the
      // AgentRecord skip the write.
      logger?.warn("bns.lookup_contract_error", { stxAddress });
      await setCachedBnsContractError(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    const cv = deserializeCV(data.result);
    const json = cvToJSON(cv);

    // BNS-V2 `get-primary` response shape, per contract source:
    //   (ok (some { name: (buff 48), namespace: (buff 20) })) — address has a primary name
    //   (err u131) ERR-NO-PRIMARY-NAME                        — address has no primary name
    // The `(ok none)` branch below is defense-in-depth in case the contract
    // ever emits an empty optional for "no primary name" instead of the err.
    if (!json.success) {
      const errCode = json.value?.value;
      if (errCode === BNS_ERR_NO_PRIMARY_NAME) {
        // Authoritative "no primary name" — cache as confirmed-negative (7d).
        await setCachedBnsNegative(stxAddress, kv, logger);
        return { state: "confirmed-negative", name: null };
      }
      logger?.warn("bns.lookup_malformed_response", { stxAddress, errCode });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    // Unwrap: response -> optional -> tuple
    const optional = json.value?.value;
    if (!optional) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return { state: "confirmed-negative", name: null };
    }

    const tuple = optional.value;
    if (!tuple?.name?.value || !tuple?.namespace?.value) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return { state: "confirmed-negative", name: null };
    }

    const name = bytesToUtf8(hexToBytes(tuple.name.value));
    const namespace = bytesToUtf8(hexToBytes(tuple.namespace.value));
    const fullName = `${name}.${namespace}`;

    await setCachedBnsName(stxAddress, fullName, kv, logger);
    return { state: "positive", name: fullName };
  } catch (e) {
    logger?.error("bns.lookup_failed", { stxAddress, error: String(e) });
    await setCachedBnsLookupFailed(stxAddress, kv, logger);
    return { state: "lookup-failed", name: null };
  }
}

/**
 * Look up the BNS name for a Stacks address using BNS-V2.
 *
 * Calls the `get-primary` read-only function on the BNS-V2 contract,
 * which returns the primary name+namespace for an owner address.
 *
 * BNS V1 is deprecated — all names have been migrated to V2.
 *
 * Returns the BNS name or null (both confirmed-negative and lookup-failed
 * collapse to null). Use {@link lookupBnsNameWithOutcome} if you need to
 * distinguish those two cases (e.g. to avoid overwriting a stored value
 * during a transient Hiro incident).
 *
 * @param stxAddress - Stacks address to lookup
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @param kv - Optional KV namespace for persistent caching
 * @param logger - Optional Logger for cache telemetry and error logging
 */
export async function lookupBnsName(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<string | null> {
  const outcome = await lookupBnsNameWithOutcome(
    stxAddress,
    hiroApiKey,
    kv,
    logger
  );
  return outcome.name;
}

// Re-export for convenience so refresh-style callers can import once.
export type { LookupOutcomeState };
