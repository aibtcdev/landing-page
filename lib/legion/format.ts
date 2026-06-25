/**
 * Display helpers for Legion sats values. Kept tiny and dependency-free so both
 * the server snapshot and client components can share them.
 */

import { SBTC_DECIMALS } from "./constants";

/** Format integer sats as an sBTC string (8 dp, trailing zeros trimmed). */
export function formatSbtc(sats: number | null | undefined): string {
  if (sats == null || !Number.isFinite(sats)) return "—";
  const sbtc = sats / 10 ** SBTC_DECIMALS;
  // Up to 8 dp, but trim trailing zeros for readability (0.30000000 → 0.3).
  return sbtc.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: SBTC_DECIMALS,
  });
}

/** Shorten a Stacks address to `ST12…WX9Z`. */
export function shortAddress(address: string, head = 5, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Coerce a decoded Clarity value (often a uint string) to a finite number, else 0. */
export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Safe property read off a decoded Clarity tuple (plain object), else undefined. */
export function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}
