/**
 * Shared Stacks API utilities for read-only contract calls.
 *
 * Used by both identity detection and reputation modules to avoid
 * duplicating callReadOnly() and parseClarityValue() logic.
 */

import { STACKS_API_BASE } from "./constants";

/**
 * Call a read-only function on a Stacks smart contract.
 *
 * @param contract - Fully-qualified contract identifier (e.g. "SP...address.contract-name")
 * @param functionName - The read-only function to call
 * @param args - Clarity-encoded arguments
 */
export async function callReadOnly(
  contract: string,
  functionName: string,
  args: string[]
): Promise<any> {
  const [contractAddress, contractName] = contract.split(".");
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
 * Parse a Clarity value from the Stacks API response.
 *
 * Handles: uint, int, principal, string-utf8, string-ascii,
 * bool, optional, response, tuple, and list types.
 */
export function parseClarityValue(result: any): any {
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
