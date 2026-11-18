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
 * events grew. `loadedOffsets` lists the offsets those pages started at, so
 * `boundTxEventsGap` can clear a gap that has healed.
 */
export type TxEventsLoad = { pages: number; loadedOffsets?: number[] } & (
  /** `found` accepted the events loaded so far. */
  | { state: "found" }
  /** `tx.events` holds every event and `found` did not accept them. */
  | { state: "complete" }
  /** `TX_EVENT_MAX` events were loaded without a match and the transaction has more. Final. */
  | { state: "truncated" }
  /**
   * Hiro will not serve the rest: a later page rejected with 400 / 422, the
   * page-fetch cap reached short of `TX_EVENT_MAX` (pages smaller than
   * requested), or a gap `boundTxEventsGap` has given up on. Final.
   */
  | { state: "incomplete" }
  /**
   * A page could not be read (network, timeout, any non-ok status but 400 /
   * 422, or an empty page while events are still missing); retrying may
   * succeed. `gapOffset` is set only for a 404 or an empty page: Hiro answered
   * but has no page at that offset yet, most likely index lag.
   * `boundTxEventsGap` limits how long that stays retryable.
   */
  | { state: "unreachable"; response?: Response; gapOffset?: number }
);

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
  const loadedOffsets: number[] = [];
  let fetches = 0;
  const loaded = () =>
    loadedOffsets.length ? { pages: loadedOffsets.length, loadedOffsets } : { pages: 0 };

  for (;;) {
    if (found(events)) return { state: "found", ...loaded() };
    if (total == null || events.length >= total) return { state: "complete", ...loaded() };
    if (events.length >= TX_EVENT_MAX) return { state: "truncated", ...loaded() };
    if (fetches >= TX_EVENT_MAX_PAGE_FETCHES) return { state: "incomplete", ...loaded() };

    let page: E[] | undefined;
    fetches++;
    try {
      const res = await fetchFn(`${txUrl}${txEventsQuery(events.length)}`);
      if (!res.ok) {
        // Release the connection; the headers (Retry-After) stay readable.
        await res.body?.cancel().catch(() => {});
        if (isFinalHiroRejection(res.status)) return { state: "incomplete", ...loaded() };
        // Only a 404 is lag at this offset; 401/403/408, 429 and 5xx are about
        // the path to Hiro, not this page, so they never start the gap clock.
        return {
          state: "unreachable",
          ...loaded(),
          response: res,
          ...(res.status === 404 && { gapOffset: events.length }),
        };
      }
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable", ...loaded() };
    }
    // Hiro counted more events than it returns. Page 0 already found the tx,
    // so this is most likely a replica or indexer still catching up: retryable.
    if (!page?.length) return { state: "unreachable", ...loaded(), gapOffset: events.length };
    loadedOffsets.push(events.length);
    events.push(...page);
  }
}

/** A gap still there this long after it was first hit is a hole, not lag. */
export const TX_EVENT_GAP_MAX_AGE_MS = 15 * 60 * 1000;

/** How long a gap record is kept; well past `TX_EVENT_GAP_MAX_AGE_MS`. */
const TX_EVENT_GAP_TTL_SECONDS = 24 * 60 * 60;

/** KV key of the gap record for `txid` at event `offset`. */
export function txEventsGapKey(txid: string, offset: number): string {
  return `tx-events-gap:${txid.toLowerCase().replace(/^0x/, "")}:${offset}`;
}

/**
 * Bound how long an event gap stays retryable, so a hole in Hiro's index that
 * never heals still ends in a verdict. The first time a load hits a gap
 * (`gapOffset`), the time is written to KV under txid + offset, once. From
 * `TX_EVENT_GAP_MAX_AGE_MS` after that first hit, the load comes back as
 * `incomplete`, which callers report as final with their "do not pay again"
 * message. The bound depends on time only, not on how often clients retry, and
 * the record is never rewritten, so concurrent requests cannot move it.
 *
 * A page read at an offset clears any record there, so a gap that healed does
 * not make a later lag at that offset final at once. Without KV, or when KV
 * fails, the load is returned as is: a gap is never made final on a guess.
 *
 * Approach from aibtcdev/landing-page#1147.
 */
export async function boundTxEventsGap(
  load: TxEventsLoad,
  txid: string,
  kv: Pick<KVNamespace, "get" | "put" | "delete"> | undefined,
  now: number = Date.now()
): Promise<TxEventsLoad> {
  if (!kv) return load;
  try {
    for (const offset of load.loadedOffsets ?? []) {
      const key = txEventsGapKey(txid, offset);
      // A get costs less than a delete, and most loads have no record to clear.
      if ((await kv.get(key)) != null) await kv.delete(key);
    }
  } catch {
    // A record left behind only shortens a later gap's window: carry on.
  }
  if (load.state !== "unreachable" || load.gapOffset == null) return load;
  const key = txEventsGapKey(txid, load.gapOffset);
  try {
    const prev = await kv.get(key);
    const firstAt = prev ? (JSON.parse(prev) as { firstAt?: unknown }).firstAt : undefined;
    if (typeof firstAt !== "number") {
      await kv.put(key, JSON.stringify({ firstAt: now }), {
        expirationTtl: TX_EVENT_GAP_TTL_SECONDS,
      });
      return load;
    }
    if (now - firstAt >= TX_EVENT_GAP_MAX_AGE_MS) {
      const { pages, loadedOffsets } = load;
      return { state: "incomplete", pages, ...(loadedOffsets && { loadedOffsets }) };
    }
  } catch {
    // Fail open: the load stays retryable.
  }
  return load;
}
