/**
 * Read every event of a transaction from Hiro.
 *
 * `GET /extended/v1/tx/{txid}` returns one page of events and reports the
 * total in `event_count`. A payment verifier that reads only the first page
 * can miss the transfer it looks for in a long transaction, and then blames
 * the payer for it. Callers fetch the first page with `txEventsQuery(0)` and
 * hand the response to `loadRemainingTxEvents`.
 */

/** Hiro's maximum `event_limit` on `GET /extended/v1/tx/{txid}`. */
export const TX_EVENT_PAGE_SIZE = 100;

/** Longest transaction read in full; a longer one is reported as truncated. */
export const TX_EVENT_MAX = 500;

/** Query string for the page of events that starts at `offset`. */
export function txEventsQuery(offset: number): string {
  return `?event_limit=${TX_EVENT_PAGE_SIZE}&event_offset=${offset}`;
}

/** Outcome of `loadRemainingTxEvents`. */
export type TxEventsLoad =
  /** `tx.events` holds every event; `fetched` says whether a page was read. */
  | { state: "complete"; fetched: boolean }
  /** The transaction has more than `TX_EVENT_MAX` events. */
  | { state: "truncated" }
  /** A page could not be read; retrying may succeed. `response` is the failed one, if any. */
  | { state: "unreachable"; response?: Response };

/** Append the events missing from `tx.events`, one page at a time. */
export async function loadRemainingTxEvents<E>(
  tx: { event_count?: number; events?: E[] },
  txUrl: string,
  fetchFn: (url: string) => Promise<Response>
): Promise<TxEventsLoad> {
  const total = tx.event_count;
  const events = (tx.events ??= []);
  if (total == null || events.length >= total) return { state: "complete", fetched: false };
  if (total > TX_EVENT_MAX) return { state: "truncated" };

  while (events.length < total) {
    let page: E[] | undefined;
    try {
      const res = await fetchFn(`${txUrl}${txEventsQuery(events.length)}`);
      if (!res.ok) return { state: "unreachable", response: res };
      page = ((await res.json()) as { events?: E[] }).events;
    } catch {
      return { state: "unreachable" };
    }
    // Hiro counted more events than it returns: an indexer gap, not the tx.
    if (!page?.length) return { state: "unreachable" };
    events.push(...page);
  }
  return { state: "complete", fetched: true };
}
