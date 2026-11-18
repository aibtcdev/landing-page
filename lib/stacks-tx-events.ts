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
 * Which Hiro answers are final: only a 400 or 422, which reject the request
 * itself. Everything else that is not ok (401, 403, 404, 408, 429, 5xx), an
 * empty later page, or a network failure is about the path to Hiro or its
 * indexer catching up, so it stays retryable.
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
 * through the default retries on every page. `retries` and `retries429` are
 * max attempts, so this is one attempt per page and no retry: a failed page
 * comes back as `unreachable` and the client retries the whole request.
 */
export const TX_EVENT_PAGE_FETCH_CONFIG: Pick<
  StacksApiFetchConfig,
  "retries" | "retries429" | "perAttemptTimeoutMs"
> = { retries: 1, retries429: 1, perAttemptTimeoutMs: SYNC_PER_ATTEMPT_TIMEOUT_MS };

/**
 * True when a non-ok Hiro status rejects the request itself (bad txid or
 * query), so the same request gets the same answer. Any other status is about
 * the path to Hiro (auth, rate limit, timeout, outage, indexer lag) and is
 * retryable.
 */
export function isFinalHiroRejection(status: number): boolean {
  return status === 400 || status === 422;
}

/**
 * A Hiro `fungible_token_asset` event. Hiro nests the transfer under `asset`;
 * an alternative flat shape carries the same fields on the event itself.
 */
export interface HiroFtEventFields {
  asset_event_type?: string;
  asset_id?: string;
  sender?: string;
  recipient?: string;
  amount?: string;
}

export interface HiroFtEvent extends HiroFtEventFields {
  event_type: string;
  asset?: HiroFtEventFields;
}

/**
 * The FT transfer an event carries, from either shape, or null when it is not
 * one: another event type, a mint or burn, or a field missing. An event with
 * no `asset_event_type` is judged on its fields alone. Both payment verifiers
 * read FT events through this, so they accept the same shapes.
 */
export function readFtTransfer(
  ev: HiroFtEvent
): { assetId: string; sender: string; recipient: string; amount: number } | null {
  if (ev.event_type !== "fungible_token_asset") return null;
  const type = ev.asset?.asset_event_type ?? ev.asset_event_type;
  if (type != null && type !== "transfer") return null;
  const assetId = ev.asset?.asset_id ?? ev.asset_id;
  const sender = ev.asset?.sender ?? ev.sender;
  const recipient = ev.asset?.recipient ?? ev.recipient;
  const rawAmount = ev.asset?.amount ?? ev.amount;
  const amount = rawAmount == null ? NaN : Number(rawAmount);
  if (!assetId || !sender || !recipient || !Number.isFinite(amount)) return null;
  return { assetId, sender, recipient, amount };
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
   * Hiro will not serve the rest: a later page rejected with 400 / 422, or the
   * page-fetch cap reached short of `TX_EVENT_MAX` (pages smaller than
   * requested). The same request gets the same answer, so this is final.
   */
  | { state: "incomplete"; pages: number }
  /**
   * A page could not be read (network, timeout, any non-ok status but 400 /
   * 422, or an empty page while events are still missing); retrying may succeed.
   */
  | { state: "unreachable"; pages: number; response?: Response };

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
        return isFinalHiroRejection(res.status)
          ? { state: "incomplete", pages }
          : { state: "unreachable", pages, response: res };
      }
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable", pages };
    }
    // Hiro counted more events than it returns. Page 0 already found the tx,
    // so this is most likely a replica or indexer still catching up: retryable.
    if (!page?.length) return { state: "unreachable", pages };
    events.push(...page);
    pages++;
  }
}
