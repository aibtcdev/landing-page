/**
 * Inbox-reconcile cursor encoding helpers (Phase 1.4 path A).
 *
 * Lives outside `app/api/admin/reconcile/route.ts` because Next.js App Router
 * rejects non-Route exports from `route.ts` files at build time
 * ("'encodeCursor' is not a valid Route export field"). Tests + the route
 * import these from this module.
 */

/**
 * Accumulated counts carried across paginated inbox reconcile calls.
 */
export interface InboxPartialCounts {
  kv_count: number;
  drift_explained_partial_cascade: number;
  drift_explained_unique_payment_txid_replay: number;
  drift_explained_unresolvable_stx_reply: number;
  /** txid → occurrence count, carried between pages to detect cross-page duplicates */
  txidCounts: Record<string, number>;
}

/**
 * Cursor state serialized as base64(JSON) and passed between paginated calls.
 */
export interface InboxCursorState {
  /** Which KV prefix we are currently scanning */
  prefix: "inbox:message:" | "inbox:reply:";
  /** KV pagination cursor for the current prefix (null = start of prefix) */
  kvCursor: string | null;
  /** Accumulated counts so far */
  partialCounts: InboxPartialCounts;
}

/** Encode cursor state to a base64url string safe for URL query parameters. */
export function encodeCursor(state: InboxCursorState): string {
  const json = JSON.stringify(state);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decode a base64url cursor string back to InboxCursorState.
 *
 * Throws `Error("decodeCursor: malformed cursor shape")` on wrong-shape JSON
 * or invalid base64. The route's POST handler catches this and returns 400.
 */
export function decodeCursor(encoded: string): InboxCursorState {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const json = atob(padded + pad);
  const parsed = JSON.parse(json) as unknown;
  // Structural validation — a malformed cursor (wrong type, missing fields,
  // injected from external source) must throw cleanly, not produce a runtime
  // error deep in the inbox loop.
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("prefix" in parsed) ||
    (parsed.prefix !== "inbox:message:" && parsed.prefix !== "inbox:reply:") ||
    !("kvCursor" in parsed) ||
    (parsed.kvCursor !== null && typeof parsed.kvCursor !== "string") ||
    !("partialCounts" in parsed) ||
    !parsed.partialCounts ||
    typeof parsed.partialCounts !== "object" ||
    !("txidCounts" in (parsed.partialCounts as object)) ||
    typeof (parsed.partialCounts as Record<string, unknown>).txidCounts !== "object"
  ) {
    throw new Error("decodeCursor: malformed cursor shape");
  }
  return parsed as InboxCursorState;
}
