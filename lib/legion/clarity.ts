/**
 * Clarity value decoding for the legion reads and chainhook payloads.
 *
 * @stacks/transactions v7 decodes to `{ type, value }` wrappers with bigint
 * integers. Everything downstream here wants plain JSON: a tuple as an object,
 * a uint as a number, an optional or response as its inner value. The share and
 * sat figures these contracts deal in sit far below 2^53, so Number is exact.
 */

import { Cl, ClarityType, hexToCV, serializeCV, type ClarityValue } from "@stacks/transactions";

export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };

export function toPlain(cv: ClarityValue): Plain {
  switch (cv.type) {
    case ClarityType.Int:
    case ClarityType.UInt:
      return Number(cv.value);
    case ClarityType.BoolTrue:
      return true;
    case ClarityType.BoolFalse:
      return false;
    case ClarityType.StringASCII:
    case ClarityType.StringUTF8:
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return cv.value;
    case ClarityType.Buffer:
      return `0x${cv.value}`;
    case ClarityType.OptionalNone:
      return null;
    case ClarityType.OptionalSome:
    case ClarityType.ResponseOk:
    case ClarityType.ResponseErr:
      return toPlain(cv.value);
    case ClarityType.List:
      return cv.value.map(toPlain);
    case ClarityType.Tuple:
      return Object.fromEntries(Object.entries(cv.value).map(([k, v]) => [k, toPlain(v)]));
    default:
      return null;
  }
}

/** Decode a serialized Clarity value, or undefined when it is not one. */
export function decodeClarityHex(hex: string): ClarityValue | undefined {
  try {
    return hexToCV(hex.startsWith("0x") ? hex.slice(2) : hex);
  } catch {
    return undefined;
  }
}

/**
 * A number from any spelling a print value arrives in: a decoded number, a
 * bigint, or a string like "3000" or "u3000" from a pre-decoded payload.
 */
export function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && /^u?\d+$/.test(v)) return Number(v.replace(/^u/, ""));
  return null;
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A principal, serialized as a read-only call argument. */
export function principalArg(address: string): string {
  return `0x${serializeCV(Cl.principal(address))}`;
}

/** A uint, serialized as a read-only call argument. */
export function uintArg(n: number): string {
  return `0x${serializeCV(Cl.uint(n))}`;
}
