/**
 * The public meta legion state, shared by `GET /api/meta-legion` and the
 * server-rendered `/meta-legion` page.
 *
 * Event-driven, like /legions. Hiro Chainhooks deliver the exchange's print
 * events to POST /api/meta-legion/chainhook, which stores them in D1
 * (`legion_events`, keyed by the exchange's contract id). Every request reads
 * them fresh and folds them into legions, the book and the scoreboard
 * (lib/meta-legion/state.ts). The only chain read is the burn tip, which the
 * epochs and countdowns are measured against, edge-cached for TIP_TTL_SECONDS.
 * The response is `no-store`: the zone's Browser Cache TTL rewrites
 * `max-age=0` to four hours.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withEdgeCache } from "../edge-cache";
import { createConsoleLogger } from "../logging";
import { readBurnTip, type BurnTip } from "../legion/chain";
import { listLegionEvents } from "../legion/d1";
import type { EventRow } from "../legion/chainhook";
import { EXCHANGE_CONTRACT, MAX_EVENTS, TERMS, TIP_TTL_SECONDS, type MetaTerms } from "./constants";
import {
  epochOf,
  epochWindows,
  foldExchange,
  type EpochWindow,
  type FeedItem,
  type LegionRow,
  type Order,
} from "./state";

const log = createConsoleLogger({ module: "meta-legion" });

const TIP_CACHE_KEY = "https://cache.aibtc.local/meta-legion/tip";
const BURN_BLOCK_SECONDS = 600;

export interface MetaLegionState {
  contract: string;
  tip: number | null;
  /** Unix seconds of the tip block, the anchor every countdown counts toward. */
  tipTime: number | null;
  blockSeconds: number;
  generatedAt: number;
  terms: MetaTerms;
  /** `meta-count`: the lowest qualified count across the counted epochs. */
  score: number;
  currentEpoch: number | null;
  epochs: EpochWindow[];
  /** Legion 0. */
  meta: LegionRow;
  /** Every other legion, newest first. */
  legions: LegionRow[];
  /** Orders with shares left, across every legion. */
  orders: Order[];
  /** Newest first. */
  feed: FeedItem[];
  /** Events folded. */
  indexed: number;
  /** False when the event store could not be read, or the fold hit MAX_EVENTS. */
  complete: boolean;
}

async function readCachedTip(apiKey?: string): Promise<BurnTip> {
  const res = await withEdgeCache(TIP_CACHE_KEY, TIP_TTL_SECONDS, async () => {
    const tip = await readBurnTip(apiKey);
    const cacheControl = tip.height == null ? "no-store" : `public, s-maxage=${TIP_TTL_SECONDS}`;
    return Response.json(tip, { headers: { "Cache-Control": cacheControl } });
  });
  return (await res.json()) as BurnTip;
}

/** Fold stored events against a tip. Pure apart from the clock. */
export function buildMetaLegionState(
  events: readonly EventRow[] | null,
  tip: BurnTip,
  terms: MetaTerms = TERMS
): MetaLegionState {
  const fold = foldExchange(events ?? [], terms);
  const epochs = epochWindows(terms, tip.height, fold.qualifiedCounts);
  return {
    contract: EXCHANGE_CONTRACT,
    tip: tip.height,
    tipTime: tip.time,
    blockSeconds: BURN_BLOCK_SECONDS,
    generatedAt: Math.floor(Date.now() / 1000),
    terms,
    // Mirrors `meta-count`: the lowest of the three counted epochs.
    score: Math.min(...epochs.map((e) => e.qualifiedCount)),
    currentEpoch: tip.height == null ? null : epochOf(tip.height, terms.epochBlocks),
    epochs,
    meta: fold.meta,
    legions: fold.legions,
    orders: fold.orders,
    feed: fold.feed,
    indexed: events?.length ?? 0,
    complete: events != null && events.length < MAX_EVENTS,
  };
}

/**
 * Bindings when there is a Worker context. Plain `next dev` has none: the page
 * still renders, with an empty event log and an unauthenticated tip read.
 */
async function bindings(): Promise<{ db?: D1Database; apiKey?: string }> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return { db: env.DB as D1Database | undefined, apiKey: env.HIRO_API_KEY };
  } catch {
    return {};
  }
}

async function loadState(): Promise<MetaLegionState> {
  const { db, apiKey } = await bindings();
  const [events, tip] = await Promise.all([
    db
      ? listLegionEvents(db, [EXCHANGE_CONTRACT], MAX_EVENTS).catch((err) => {
          log.error("meta_legion.events_read_failed", { error: String(err) });
          return null;
        })
      : Promise.resolve(null),
    readCachedTip(apiKey),
  ]);
  return buildMetaLegionState(events, tip);
}

/** The state as a response. Never cached by the browser or the CDN. */
export async function metaLegionStateResponse(): Promise<Response> {
  return Response.json(await loadState(), { headers: { "Cache-Control": "no-store" } });
}

/** The same state for the Server Component. Null rather than a throw, so SWR can retry. */
export async function loadMetaLegionState(): Promise<MetaLegionState | null> {
  try {
    return await loadState();
  } catch (err) {
    log.error("meta_legion.state_build_failed", { error: String(err) });
    return null;
  }
}
