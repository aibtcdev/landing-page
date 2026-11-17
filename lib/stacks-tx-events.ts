/**
 * Read the events of a transaction from Hiro, page by page, until a caller's
 * predicate is satisfied.
 *
 * `GET /extended/v1/tx/{txid}` returns one page of events and reports the
 * total in `event_count`. A payment verifier that reads only the first page
 * can miss the transfer it looks for in a long transaction, and then blames
 * the payer for it. Callers fetch the first page with `txEventsQuery(0)` and
 * hand the response to `loadTxEventsUntil`.
 *
 * Every loaded event is on-chain proof, so a caller may ACCEPT on a partial
 * load. A caller may only REFUSE on the payment itself once the load is
 * `complete`. `truncated` and `incomplete` are final (retrying repeats the same
 * answer); only `unreachable` is worth retrying.
 *
 * Page 0 already found the transaction, so a later page that comes back 404,
 * empty, or with any 4xx other than 400/422 is most plausibly a replica or
 * indexer lagging behind (#1146): it is `unreachable`, not `incomplete`.
 */

import type { StacksApiFetchConfig } from "./stacks-api-fetch";
import { SYNC_PER_ATTEMPT_TIMEOUT_MS } from "./stacks-api-fetch";

/** Hiro's maximum `event_limit` on `GET /extended/v1/tx/{txid}`. */
export const TX_EVENT_PAGE_SIZE = 100;

/** Longest transaction read in full; a longer one is reported as truncated. */
export const TX_EVENT_MAX = 500;

/** Page requests allowed per transaction, whatever size Hiro returns the pages in. */
const TX_EVENT_MAX_PAGE_FETCHES = Math.ceil(TX_EVENT_MAX / TX_EVENT_PAGE_SIZE);

/**
 * `stacksApiFetch` budget for the pages after the first. They run on a
 * synchronous request path, up to `TX_EVENT_MAX_PAGE_FETCHES - 1` times in a
 * row, so a slow or rate-limited Hiro must fail fast instead of sleeping
 * through the default retries on every page.
 *
 * `retries` and `retries429` are max ATTEMPTS in `stacksApiFetch`, so `1` means
 * a single attempt and no retry. A failed page is reported `unreachable` and
 * the client retries the whole request instead.
 */
export const TX_EVENT_PAGE_FETCH_CONFIG: Pick<
  StacksApiFetchConfig,
  "retries" | "retries429" | "perAttemptTimeoutMs"
> = { retries: 1, retries429: 1, perAttemptTimeoutMs: SYNC_PER_ATTEMPT_TIMEOUT_MS };

/** FT event fields Hiro serves either nested under `asset` or flat on the event. */
export interface HiroFtEventFields {
  asset_event_type?: string;
  asset_id?: string;
  sender?: string;
  recipient?: string;
  amount?: string;
}

/** A Hiro transaction event, as far as `readFtTransfer` looks at it. */
export type HiroFtEventLike = HiroFtEventFields & {
  event_type?: string;
  event_index?: number;
  asset?: HiroFtEventFields;
};

/** One fungible-token transfer read from a Hiro event, whichever shape it came in. */
export interface FtTransfer {
  eventIndex: number | null;
  sender: string;
  recipient: string;
  amount: number;
}

/**
 * Read `ev` as a transfer of `contractId`'s fungible token, or `null` if it is
 * not one. Accepts both the nested (`ev.asset.x`) and the flat (`ev.x`) shape,
 * so every payment verifier judges the same event the same way (#1146). Mints
 * and burns are skipped; an event that carries no type is judged on its
 * fields. The asset id is anchored on `::` so that a sibling contract such as
 * `sbtc-token-extended` never matches.
 */
export function readFtTransfer(ev: HiroFtEventLike, contractId: string): FtTransfer | null {
  if (ev.event_type !== "fungible_token_asset") return null;
  const type = ev.asset?.asset_event_type ?? ev.asset_event_type;
  if (type != null && type !== "transfer") return null;
  const assetId = ev.asset?.asset_id ?? ev.asset_id;
  const sender = ev.asset?.sender ?? ev.sender;
  const recipient = ev.asset?.recipient ?? ev.recipient;
  const rawAmount = ev.asset?.amount ?? ev.amount;
  const amount = rawAmount == null ? NaN : Number(rawAmount);
  if (!assetId?.startsWith(`${contractId}::`) || !sender || !recipient || !Number.isFinite(amount)) {
    return null;
  }
  return { eventIndex: ev.event_index ?? null, sender, recipient, amount };
}

/** Every transfer of `contractId`'s token in `events`, in event order. */
export function readFtTransfers(events: HiroFtEventLike[] | undefined, contractId: string): FtTransfer[] {
  const found: FtTransfer[] = [];
  for (const ev of events ?? []) {
    const t = readFtTransfer(ev, contractId);
    if (t) found.push(t);
  }
  return found;
}

/** Query string for the page of events that starts at `offset`. */
export function txEventsQuery(offset: number): string {
  return `?event_limit=${TX_EVENT_PAGE_SIZE}&event_offset=${offset}`;
}

/**
 * Outcome of `loadTxEventsUntil`. `pages` is how many later pages were loaded
 * into `tx.events` (failed fetches are not counted), so `pages > 0` means the
 * events grew.
 */
export type TxEventsLoad =
  /** `found` accepted the events loaded so far. */
  | { state: "found"; pages: number }
  /** `tx.events` holds every event and `found` did not accept them. */
  | { state: "complete"; pages: number }
  /** `TX_EVENT_MAX` events were loaded without a match and the transaction has more. Final. */
  | { state: "truncated"; pages: number }
  /**
   * Hiro will not serve the rest: a later page refused as a bad request
   * (400/422), or the page-fetch cap reached short of `TX_EVENT_MAX` (pages
   * smaller than requested). The same request gets the same answer, so this is
   * final, not retryable.
   */
  | { state: "incomplete"; pages: number }
  /**
   * A page could not be read (network, timeout, 429, 5xx, or a 404 / other 4xx /
   * empty later page, which after page 0 found the tx means lag); retrying may
   * succeed.
   */
  | { state: "unreachable"; pages: number; response?: Response };

/** Later-page HTTP statuses that are a verdict on the request itself, not lag. */
const FINAL_LATER_PAGE_STATUSES = new Set([400, 422]);

/**
 * Append the events missing from `tx.events`, one page at a time, and stop as
 * soon as `found(tx.events)` is true. `found` must accept a subset of what the
 * caller's real checks accept, so that stopping early can never accept a
 * payment those checks would refuse.
 */
export async function loadTxEventsUntil<E>(
  tx: { event_count?: number; events?: E[] },
  txUrl: string,
  fetchFn: (url: string) => Promise<Response>,
  found: (events: E[]) => boolean
): Promise<TxEventsLoad> {
  const total = tx.event_count;
  const events = (tx.events ??= []);
  let pages = 0;
  let fetches = 0;

  for (;;) {
    if (found(events)) return { state: "found", pages };
    if (total == null || events.length >= total) return { state: "complete", pages };
    if (events.length >= TX_EVENT_MAX) return { state: "truncated", pages };
    if (fetches >= TX_EVENT_MAX_PAGE_FETCHES) return { state: "incomplete", pages };

    let page: E[] | undefined;
    fetches++;
    try {
      const res = await fetchFn(`${txUrl}${txEventsQuery(events.length)}`);
      if (!res.ok) {
        // Release the connection; the headers (Retry-After) stay readable.
        await res.body?.cancel().catch(() => {});
        return FINAL_LATER_PAGE_STATUSES.has(res.status)
          ? { state: "incomplete", pages }
          : { state: "unreachable", pages, response: res };
      }
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable", pages };
    }
    // Hiro counted more events than it returns. Page 0 already served the tx,
    // so this is most plausibly a lagging replica or indexer: retryable.
    if (!page?.length) return { state: "unreachable", pages };
    events.push(...page);
    pages++;
  }
}
