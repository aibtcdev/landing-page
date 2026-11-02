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
 * load. A caller may only REFUSE once the load is `complete`; `truncated` and
 * `unreachable` mean the missing events might still hold the payment.
 */

/** Hiro's maximum `event_limit` on `GET /extended/v1/tx/{txid}`. */
export const TX_EVENT_PAGE_SIZE = 100;

/** Longest transaction read in full; a longer one is reported as truncated. */
export const TX_EVENT_MAX = 500;

/** Page requests allowed per transaction, whatever size Hiro returns the pages in. */
const TX_EVENT_MAX_PAGE_FETCHES = Math.ceil(TX_EVENT_MAX / TX_EVENT_PAGE_SIZE);

/** Query string for the page of events that starts at `offset`. */
export function txEventsQuery(offset: number): string {
  return `?event_limit=${TX_EVENT_PAGE_SIZE}&event_offset=${offset}`;
}

/** Outcome of `loadTxEventsUntil`; `pages` is how many later pages were fetched. */
export type TxEventsLoad =
  /** `found` accepted the events loaded so far. */
  | { state: "found"; pages: number }
  /** `tx.events` holds every event and `found` did not accept them. */
  | { state: "complete"; pages: number }
  /** `TX_EVENT_MAX` events were loaded without a match and the transaction has more. */
  | { state: "truncated"; pages: number }
  /** A page could not be read; retrying may succeed. `response` is the failed one, if any. */
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

  for (;;) {
    if (found(events)) return { state: "found", pages };
    if (total == null || events.length >= total) return { state: "complete", pages };
    if (events.length >= TX_EVENT_MAX) return { state: "truncated", pages };
    if (pages >= TX_EVENT_MAX_PAGE_FETCHES) return { state: "unreachable", pages };

    let page: E[] | undefined;
    pages++;
    try {
      const res = await fetchFn(`${txUrl}${txEventsQuery(events.length)}`);
      if (!res.ok) {
        // Release the connection; the headers (Retry-After) stay readable.
        await res.body?.cancel().catch(() => {});
        return { state: "unreachable", pages, response: res };
      }
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable", pages };
    }
    // Hiro counted more events than it returns: an indexer gap, not the tx.
    // Retryable, but expect it to persist until the indexer catches up.
    if (!page?.length) return { state: "unreachable", pages };
    events.push(...page);
  }
}
