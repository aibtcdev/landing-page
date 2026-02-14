import {
  deserializeCV,
  principalCV,
  serializeCV,
  cvToJSON,
} from "@stacks/transactions";
import { hexToBytes, bytesToUtf8 } from "@stacks/common";

const BNS_V2_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BNS_V2_NAME = "BNS-V2";
const HIRO_API = "https://api.hiro.so";

/**
 * Convert a hex-encoded buffer value (e.g. "0x636f636f61303037") to a UTF-8 string.
 */
function hexBufferToString(hexValue: string): string {
  const hex = hexValue.startsWith("0x") ? hexValue.slice(2) : hexValue;
  return bytesToUtf8(hexToBytes(hex));
}

/**
 * Look up the BNS name for a Stacks address using BNS-V2.
 *
 * Calls the `get-primary` read-only function on the BNS-V2 contract,
 * which returns the primary name+namespace for an owner address.
 *
 * BNS V1 is deprecated — all names have been migrated to V2.
 */
export async function lookupBnsName(
  stxAddress: string
): Promise<string | null> {
  try {
    const principal = principalCV(stxAddress);
    const serialized = serializeCV(principal);

    const res = await fetch(
      `${HIRO_API}/v2/contracts/call-read/${BNS_V2_CONTRACT}/${BNS_V2_NAME}/get-primary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: stxAddress,
          arguments: [`0x${serialized}`],
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { okay: boolean; result: string };
    if (!data.okay) return null;

    const cv = deserializeCV(data.result);
    const json = cvToJSON(cv);

    // Response structure: (ok (some {name: buff, namespace: buff})) or (ok none)
    // cvToJSON gives: { value: { value: { value: { name: { value: "0x..." }, namespace: { value: "0x..." } } } }, success: true }
    if (!json.success) return null;

    // Unwrap: response -> optional -> tuple
    const optional = json.value?.value;
    if (!optional) return null;

    const tuple = optional.value;
    if (!tuple?.name?.value || !tuple?.namespace?.value) return null;

    const name = hexBufferToString(tuple.name.value);
    const namespace = hexBufferToString(tuple.namespace.value);

    return `${name}.${namespace}`;
  } catch {
    return null;
  }
}
