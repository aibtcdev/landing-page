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
 * Status codes on a later page follow the page-0 rule of both verifiers: only
 * a 400 is a verdict on the request (`incomplete`, final). Page 0 already found
 * the transaction, so a later page that comes back 404 or empty is most
 * plausibly a replica or indexer lagging behind (#1146): it is `unreachable`
 * and carries `gapOffset`, and `boundTxEventsGap` turns it final once the same
 * gap is older than `TX_EVENT_GAP_MAX_AGE_MS`, so a lasting hole in Hiro's
 * index still ends in a verdict. Any other 4xx (401/403/408/422 ...) is about
 * the path to Hiro, not the page, and stays retryable with no `gapOffset`,
 * like a 429, a 5xx or a network failure.
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
 * so every payment verifier judges the same event the same way (#1146). One
 * shape is picked per event (`asset` when present, else the event itself), so
 * a transfer is never assembled from fields of both. Mints and burns are
 * skipped; an event that carries no type is judged on its fields. The asset id
 * is anchored on `::` so that a sibling contract such as `sbtc-token-extended`
 * never matches.
 */
export function readFtTransfer(ev: HiroFtEventLike, contractId: string): FtTransfer | null {
  if (ev.event_type !== "fungible_token_asset") return null;
  const f: HiroFtEventFields = ev.asset ?? ev;
  if (f.asset_event_type != null && f.asset_event_type !== "transfer") return null;
  const amount = f.amount == null ? NaN : Number(f.amount);
  if (!f.asset_id?.startsWith(`${contractId}::`) || !f.sender || !f.recipient || !Number.isFinite(amount)) {
    return null;
  }
  return { eventIndex: ev.event_index ?? null, sender: f.sender, recipient: f.recipient, amount };
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
 * events grew. `loadedOffsets` lists the offsets those pages started at; it is
 * present only when `pages > 0`, and `boundTxEventsGap` clears any gap record
 * at those offsets.
 */
export type TxEventsLoad = { pages: number; loadedOffsets?: number[] } & (
  /** `found` accepted the events loaded so far. */
  | { state: "found" }
  /** `tx.events` holds every event and `found` did not accept them. */
  | { state: "complete" }
  /** `TX_EVENT_MAX` events were loaded without a match and the transaction has more. Final. */
  | { state: "truncated" }
  /**
   * Hiro will not serve the rest: a later page refused as a bad request (400),
   * or the page-fetch cap reached short of `TX_EVENT_MAX` (pages smaller than
   * requested). The same request gets the same answer, so this is final, not
   * retryable.
   */
  | { state: "incomplete" }
  /**
   * A page could not be read (network, timeout, 429, 5xx, any 4xx other than
   * 400, or an empty later page); retrying may succeed. `gapOffset` is set only
   * for the lag case, a 404 or an empty page: Hiro answered, but has no page at
   * that offset yet. `boundTxEventsGap` bounds how long that stays retryable.
   */
  | { state: "unreachable"; response?: Response; gapOffset?: number }
);

/**
 * Later-page HTTP status that is a verdict on the request itself. The same
 * rule as page 0 in both verifiers, where only a 400 is final.
 */
const FINAL_LATER_PAGE_STATUS = 400;

/** Later-page HTTP status that, after page 0 found the tx, means index lag. */
const LAG_LATER_PAGE_STATUS = 404;

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
  const pages = () =>
    loadedOffsets.length ? { pages: loadedOffsets.length, loadedOffsets } : { pages: 0 };

  for (;;) {
    if (found(events)) return { state: "found", ...pages() };
    if (total == null || events.length >= total) return { state: "complete", ...pages() };
    if (events.length >= TX_EVENT_MAX) return { state: "truncated", ...pages() };
    if (fetches >= TX_EVENT_MAX_PAGE_FETCHES) return { state: "incomplete", ...pages() };

    let page: E[] | undefined;
    fetches++;
    try {
      const res = await fetchFn(`${txUrl}${txEventsQuery(events.length)}`);
      if (!res.ok) {
        // Release the connection; the headers (Retry-After) stay readable.
        await res.body?.cancel().catch(() => {});
        if (res.status === FINAL_LATER_PAGE_STATUS) return { state: "incomplete", ...pages() };
        // Only a 404 is lag at this offset. 401/403/408/422, 429 and 5xx are
        // about the path to Hiro or its load, not this page: no gap.
        return {
          state: "unreachable",
          ...pages(),
          response: res,
          ...(res.status === LAG_LATER_PAGE_STATUS && { gapOffset: events.length }),
        };
      }
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable", ...pages() };
    }
    // Hiro counted more events than it returns. Page 0 already served the tx,
    // so this is most plausibly a lagging replica or indexer: retryable.
    if (!page?.length) return { state: "unreachable", ...pages(), gapOffset: events.length };
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
  const id = txid.toLowerCase().replace(/^0x/, "");
  return `tx-events-gap:${id}:${offset}`;
}

/** The KV methods `boundTxEventsGap` uses. */
type GapKV = Pick<KVNamespace, "get" | "put" | "delete">;

interface GapRecord {
  firstAt: number;
}

/**
 * Bound the time an event gap stays retryable. A load that is `unreachable`
 * with a `gapOffset` (Hiro answered, but has no page at that offset yet)
 * records the time of the first hit in KV under txid + offset, written once.
 * From `TX_EVENT_GAP_MAX_AGE_MS` after that first hit, the load is returned as
 * `incomplete`, which callers treat as final with their "do not pay again"
 * message. Lag is retried; a lasting hole still ends. The bound depends only
 * on time, not on how often or how fast clients retry, and the record is never
 * rewritten, so concurrent requests cannot move it.
 *
 * A load that read a page at an offset (`loadedOffsets`) clears any gap record
 * there, so a gap that healed does not make a later lag at that offset final
 * straight away.
 *
 * Any other load is returned as is. Without KV, or when KV fails, the load
 * also stays as is (retryable): a gap is never made final on a guess.
 */
export async function boundTxEventsGap(
  load: TxEventsLoad,
  txid: string,
  kv: GapKV | undefined,
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
    const firstAt = prev ? (JSON.parse(prev) as Partial<GapRecord>).firstAt : undefined;
    if (typeof firstAt !== "number") {
      const record: GapRecord = { firstAt: now };
      await kv.put(key, JSON.stringify(record), { expirationTtl: TX_EVENT_GAP_TTL_SECONDS });
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
