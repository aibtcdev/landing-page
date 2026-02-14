import {
  deserializeCV,
  principalCV,
  serializeCV,
  cvToJSON,
} from "@stacks/transactions";
import { hexToBytes, bytesToUtf8 } from "@stacks/common";
import { getCachedBnsName, setCachedBnsName, setCachedBnsNegative, BNS_NONE_SENTINEL } from "./identity/kv-cache";
import { buildHiroHeaders } from "./identity/stacks-api";

const BNS_V2_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BNS_V2_NAME = "BNS-V2";
const HIRO_API = "https://api.hiro.so";
const BNS_TIMEOUT_MS = 5000;

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
 */
export async function lookupBnsName(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<string | null> {
  const cached = await getCachedBnsName(stxAddress, kv);
  if (cached === BNS_NONE_SENTINEL) return null;
  if (cached) return cached;

  try {
    const principal = principalCV(stxAddress);
    const serialized = serializeCV(principal);

    const headers = buildHiroHeaders(hiroApiKey);
    headers["Content-Type"] = "application/json";

    const res = await fetch(
      `${HIRO_API}/v2/contracts/call-read/${BNS_V2_CONTRACT}/${BNS_V2_NAME}/get-primary`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          sender: stxAddress,
          arguments: [`0x${serialized}`],
        }),
        signal: AbortSignal.timeout(BNS_TIMEOUT_MS),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { okay: boolean; result: string };
    if (!data.okay) return null;

    const cv = deserializeCV(data.result);
    const json = cvToJSON(cv);

    // Response structure: (ok (some {name: buff, namespace: buff})) or (ok none)
    if (!json.success) return null;

    // Unwrap: response -> optional -> tuple
    const optional = json.value?.value;
    if (!optional) return null;

    const tuple = optional.value;
    if (!tuple?.name?.value || !tuple?.namespace?.value) return null;

    const name = bytesToUtf8(hexToBytes(tuple.name.value));
    const namespace = bytesToUtf8(hexToBytes(tuple.namespace.value));
    const fullName = `${name}.${namespace}`;

    await setCachedBnsName(stxAddress, fullName, kv);
    return fullName;
  } catch {
    return null;
  }
}
