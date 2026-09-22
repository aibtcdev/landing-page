/**
 * A legion stores Bitcoin output scripts, not address strings. This turns a
 * stored script back into something a reader can check: the address it pays,
 * or, for a pay-to-pubkey output (early coins, Satoshi's genesis key), a name,
 * since those have no standard address.
 */

import { Address, NETWORK, OutScript } from "@scure/btc-signer";
import { hex } from "@scure/base";

/** Satoshi's genesis coinbase output: `41 <genesis pubkey> ac`. */
const GENESIS_P2PK =
  "4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac";

export interface ScriptView {
  /** The script as stored, 0x hex. */
  script: string;
  /** The address it pays, when it has a standard one. */
  address: string | null;
  /** What to show instead of, or beside, the address. */
  label: string;
}

export function describeScript(script: string): ScriptView {
  const raw = script.replace(/^0x/, "").toLowerCase();
  if (raw === GENESIS_P2PK) {
    return { script, address: null, label: "Genesis output (pay-to-pubkey)" };
  }
  try {
    const decoded = OutScript.decode(hex.decode(raw));
    if (decoded.type === "pk") return { script, address: null, label: "Pay-to-pubkey output" };
    const address = Address(NETWORK).encode(decoded);
    return { script, address, label: address };
  } catch {
    return { script, address: null, label: `Script 0x${raw.slice(0, 16)}…` };
  }
}
