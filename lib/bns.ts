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
  BNS_NONE_SENTINEL,
} from "./identity/kv-cache";
import { buildHiroHeaders } from "./identity/stacks-api";
import { stacksApiFetch } from "./stacks-api-fetch";
import { STACKS_API_BASE } from "./identity/constants";
import type { Logger } from "./logging";

const BNS_V2_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BNS_V2_NAME = "BNS-V2";

/**
 * Look up the BNS name for a Stacks address using BNS-V2.
 *
 * Calls the `get-primary` read-only function on the BNS-V2 contract,
 * which returns the primary name+namespace for an owner address.
 *
 * BNS V1 is deprecated — all names have been migrated to V2.
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
  const cached = await getCachedBnsName(stxAddress, kv, logger);
  if (cached === BNS_NONE_SENTINEL) return null;
  if (cached) return cached;

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
      // Transient Hiro failure (429 / 5xx / exhausted retries). Short-TTL
      // negative-cache so concurrent requests for the same address don't
      // re-hit Hiro on every miss.
      logger?.warn("bns.lookup_upstream_error", {
        stxAddress,
        status: res.status,
      });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return null;
    }

    const data = (await res.json()) as { okay: boolean; result: string };
    if (!data.okay) {
      // Contract-reported error. Treat as transient (short-TTL) rather than
      // "confirmed no name" — the contract may have thrown for reasons
      // unrelated to the address having a name.
      logger?.warn("bns.lookup_contract_error", { stxAddress });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return null;
    }

    const cv = deserializeCV(data.result);
    const json = cvToJSON(cv);

    // Response structure: (ok (some {name: buff, namespace: buff})) or (ok none)
    if (!json.success) {
      logger?.warn("bns.lookup_malformed_response", { stxAddress });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return null;
    }

    // Unwrap: response -> optional -> tuple
    const optional = json.value?.value;
    if (!optional) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return null;
    }

    const tuple = optional.value;
    if (!tuple?.name?.value || !tuple?.namespace?.value) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return null;
    }

    const name = bytesToUtf8(hexToBytes(tuple.name.value));
    const namespace = bytesToUtf8(hexToBytes(tuple.namespace.value));
    const fullName = `${name}.${namespace}`;

    await setCachedBnsName(stxAddress, fullName, kv, logger);
    return fullName;
  } catch (e) {
    // Network timeout / abort / parse error. Short-TTL negative-cache so the
    // retry storm doesn't keep hammering Hiro for the same address.
    logger?.error("bns.lookup_failed", { stxAddress, error: String(e) });
    await setCachedBnsLookupFailed(stxAddress, kv, logger);
    return null;
  }
}
