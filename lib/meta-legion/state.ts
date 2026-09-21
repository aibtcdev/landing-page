/**
 * Pure derivations for the meta legion page. The exchange's print events
 * (delivered by chainhook, stored in D1) are folded into legions, open orders
 * and the per-epoch scoreboard; the rest is epoch windows, a legion's phase and
 * the YES price the book implies. No I/O.
 */

import type { EventRow } from "../legion/chainhook";
import { asNumber } from "../legion/clarity";
import {
  EXCHANGE_CONTRACT,
  LEGION_STATUS,
  META_LEGION_ID,
  META_SUBJECT,
  PRICE_SCALE,
  SIDE,
  VOID_GRACE_BLOCKS,
  type MetaTerms,
  type Side,
} from "./constants";

export interface EpochStat {
  epoch: number;
  /** Sats traded in counted fills (the meta legion and fee-sink fills never count). */
  volume: number;
  traders: number;
  /** Cleared the bar: a `qualified` print, which the contract emits once per legion per epoch. */
  qualified: boolean;
}

export interface LegionRow {
  id: number;
  subject: string;
  creator: string;
  resolver: string;
  resolveHeight: number;
  status: number;
  /** sBTC locked in complete sets, in sats. */
  collateral: number;
  supply: number;
  /** Per-epoch counted trading, oldest epoch first. Empty for the meta legion. */
  stats: EpochStat[];
}

export interface Order {
  id: number;
  kind: "offer" | "bid";
  legion: number;
  side: Side;
  maker: string;
  /** Ten-thousandths of a sat per share. */
  price: number;
  remaining: number;
}

export type EpochState = "upcoming" | "live" | "done";

export interface EpochWindow {
  epoch: number;
  start: number;
  /** Last burn height in the epoch, inclusive. */
  end: number;
  state: EpochState;
  /** `get-qualified-count`: legions that cleared the bar in this epoch. */
  qualifiedCount: number;
}

export type LegionPhase =
  | "trading"
  | "awaiting-resolver"
  | "voidable"
  | "resolvable"
  | "yes"
  | "no"
  | "void";

export function epochOf(height: number, epochBlocks: number): number {
  return Math.floor(height / epochBlocks);
}

export function epochWindows(
  terms: MetaTerms,
  tip: number | null,
  counts: Record<number, number>
): EpochWindow[] {
  const current = tip == null ? null : epochOf(tip, terms.epochBlocks);
  return terms.epochs.map((epoch) => {
    const state: EpochState =
      current == null || current < epoch ? "upcoming" : current === epoch ? "live" : "done";
    return {
      epoch,
      start: epoch * terms.epochBlocks,
      end: (epoch + 1) * terms.epochBlocks - 1,
      state,
      qualifiedCount: counts[epoch] ?? 0,
    };
  });
}

/** Where a legion stands at `tip`. The meta legion settles by `resolve-meta`, never by void. */
export function legionPhase(row: Pick<LegionRow, "id" | "status" | "resolveHeight">, tip: number | null): LegionPhase {
  if (row.status === LEGION_STATUS.YES) return "yes";
  if (row.status === LEGION_STATUS.NO) return "no";
  if (row.status === LEGION_STATUS.VOID) return "void";
  if (tip == null || tip < row.resolveHeight) return "trading";
  if (row.id === META_LEGION_ID) return "resolvable";
  return tip >= row.resolveHeight + VOID_GRACE_BLOCKS ? "voidable" : "awaiting-resolver";
}

export interface SideBook {
  /** Offers, cheapest first. */
  asks: Order[];
  /** Bids, dearest first. */
  bids: Order[];
}

export function bookFor(orders: readonly Order[], legion: number, side: Side): SideBook {
  const mine = orders.filter((o) => o.legion === legion && o.side === side && o.remaining > 0);
  return {
    asks: mine.filter((o) => o.kind === "offer").sort((a, b) => a.price - b.price || a.id - b.id),
    bids: mine.filter((o) => o.kind === "bid").sort((a, b) => b.price - a.price || a.id - b.id),
  };
}

export interface Quote {
  /** Best price someone will pay for a YES share, in price units. */
  bid: number | null;
  /** Best price someone will sell a YES share for. */
  ask: number | null;
  /** Midpoint when both exist, else whichever side does. */
  mark: number | null;
}

/**
 * The YES price the book implies. A YES share and a NO share together redeem
 * for one sat, so a NO offer at p is a YES bid at 1 - p and a NO bid at p is a
 * YES offer at 1 - p. Both books feed one quote.
 */
export function yesQuote(orders: readonly Order[], legion: number): Quote {
  const yes = bookFor(orders, legion, SIDE.YES);
  const no = bookFor(orders, legion, SIDE.NO);
  const bids = [yes.bids[0]?.price, no.asks[0] && PRICE_SCALE - no.asks[0].price].filter(
    (p): p is number => typeof p === "number"
  );
  const asks = [yes.asks[0]?.price, no.bids[0] && PRICE_SCALE - no.bids[0].price].filter(
    (p): p is number => typeof p === "number"
  );
  const bid = bids.length ? Math.max(...bids) : null;
  const ask = asks.length ? Math.min(...asks) : null;
  const mark = bid != null && ask != null ? Math.round((bid + ask) / 2) : (bid ?? ask);
  return { bid, ask, mark };
}

/** `cost-of`: sats paid for `shares` at `price`, rounded up. */
export function costOf(shares: number, price: number): number {
  return Math.ceil((shares * price) / PRICE_SCALE);
}

/** Price units as a percentage, e.g. 5000 → "50%", 1234 → "12.3%". */
export function fmtPct(price: number | null | undefined): string {
  if (price == null) return "-";
  const pct = (price / PRICE_SCALE) * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fold
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedItem {
  txid: string;
  event: string;
  blockHeight: number;
  data: Record<string, unknown>;
}

export interface ExchangeFold {
  meta: LegionRow;
  /** Every other legion, newest first. */
  legions: LegionRow[];
  /** Orders with shares left, across every legion. */
  orders: Order[];
  /** `get-qualified-count` per epoch, from the `qualified` prints. */
  qualifiedCounts: Record<number, number>;
  /** Newest first. */
  feed: FeedItem[];
}

const FEED_LIMIT = 60;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => asNumber(v) ?? 0;

/** Legion 0 as the deploy wrote it: resolved by the contract, closing at the meta close. */
export function metaRow(terms: MetaTerms): LegionRow {
  return {
    id: META_LEGION_ID,
    subject: META_SUBJECT,
    creator: EXCHANGE_CONTRACT,
    resolver: EXCHANGE_CONTRACT,
    resolveHeight: terms.closeHeight,
    status: LEGION_STATUS.OPEN,
    collateral: 0,
    supply: 0,
    stats: [],
  };
}

/**
 * Where an event sits among others in the same block. A delivery's
 * `event_index` counts within one transaction, not the block, so two
 * transactions in one block have no stored order. Within a block the only
 * order that matters is dependency: a legion exists before it is minted, an
 * order is posted before it is filled or cancelled, a legion resolves before it
 * is redeemed. Every total the fold keeps (collateral, remaining, volume, the
 * trader set, the qualified count) is a sum or a max, so the rest commutes.
 */
const BLOCK_RANK: Record<string, number> = {
  "create-legion": 0,
  "register-share-token": 1,
  "mint-set": 1,
  "post-offer": 2,
  "post-bid": 2,
  qualified: 4,
  resolve: 5,
  "void-legion": 5,
  "resolve-meta": 5,
  redeem: 6,
};
const rankOf = (event: string) => BLOCK_RANK[event] ?? 3;

export function eventOrder(a: EventRow, b: EventRow): number {
  return (
    a.block_height - b.block_height ||
    rankOf(a.event) - rankOf(b.event) ||
    (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0) ||
    a.event_index - b.event_index
  );
}

/**
 * Replay the exchange's prints, oldest first, the way the contract applied
 * them. Fills carry the epoch they landed in; the meta legion's own fills and
 * any fill touching the fee sink never count, exactly as `record-fill` skips them.
 */
export function foldExchange(events: readonly EventRow[], terms: MetaTerms): ExchangeFold {
  const ordered = [...events].sort(eventOrder);
  const legions = new Map<number, LegionRow>([[META_LEGION_ID, metaRow(terms)]]);
  const offers = new Map<number, Order>();
  const bids = new Map<number, Order>();
  // legion → epoch → { volume, traders, qualified }
  const stats = new Map<number, Map<number, { volume: number; traders: Set<string>; qualified: boolean }>>();
  const qualifiedCounts: Record<number, number> = {};

  const statOf = (legion: number, epoch: number) => {
    let byEpoch = stats.get(legion);
    if (!byEpoch) stats.set(legion, (byEpoch = new Map()));
    let s = byEpoch.get(epoch);
    if (!s) byEpoch.set(epoch, (s = { volume: 0, traders: new Set(), qualified: false }));
    return s;
  };

  for (const e of ordered) {
    const d = e.data;
    const legion = num(d.legion);
    const row = legions.get(legion);
    switch (e.event) {
      case "create-legion":
        legions.set(legion, {
          id: legion,
          subject: str(d.subject),
          creator: str(d.creator),
          resolver: str(d.resolver),
          resolveHeight: num(d["resolve-height"]),
          status: LEGION_STATUS.OPEN,
          collateral: 0,
          supply: 0,
          stats: [],
        });
        break;
      case "mint-set":
        if (row) {
          row.collateral += num(d.amount);
          row.supply += num(d.amount);
        }
        break;
      case "merge-set":
        if (row) {
          row.collateral -= num(d.amount);
          row.supply -= num(d.amount);
        }
        break;
      case "redeem":
        if (row) row.collateral -= num(d.payout);
        break;
      case "resolve":
        if (row) row.status = num(d.outcome);
        break;
      case "void-legion":
        if (row) row.status = LEGION_STATUS.VOID;
        break;
      case "resolve-meta":
        legions.get(META_LEGION_ID)!.status = num(d.outcome);
        break;
      case "post-offer":
      case "post-bid": {
        const kind = e.event === "post-offer" ? "offer" : "bid";
        const id = num(kind === "offer" ? d.offer : d.bid);
        (kind === "offer" ? offers : bids).set(id, {
          id,
          kind,
          legion,
          side: (num(d.side) === SIDE.YES ? SIDE.YES : SIDE.NO) as Side,
          maker: str(d.maker),
          price: num(d.price),
          remaining: num(d.shares),
        });
        break;
      }
      case "cancel-offer":
        offers.delete(num(d.offer));
        break;
      case "cancel-bid":
        bids.delete(num(d.bid));
        break;
      case "fill-offer":
      case "fill-bid": {
        const book = e.event === "fill-offer" ? offers : bids;
        const id = num(e.event === "fill-offer" ? d.offer : d.bid);
        const o = book.get(id);
        if (o) {
          o.remaining = Math.max(0, o.remaining - num(d.shares));
          if (o.remaining === 0) book.delete(id);
        }
        const maker = str(d.maker);
        const taker = str(d.taker);
        if (legion !== META_LEGION_ID && maker !== terms.feeSink && taker !== terms.feeSink) {
          const s = statOf(legion, num(d.epoch));
          s.volume += num(d.gross);
          s.traders.add(maker).add(taker);
        }
        break;
      }
      case "qualified": {
        const epoch = num(d.epoch);
        statOf(legion, epoch).qualified = true;
        qualifiedCounts[epoch] = Math.max(qualifiedCounts[epoch] ?? 0, num(d.count));
        break;
      }
    }
  }

  for (const [legion, byEpoch] of stats) {
    const row = legions.get(legion);
    if (!row) continue;
    row.stats = [...byEpoch.entries()]
      .sort(([a], [b]) => a - b)
      .map(([epoch, s]) => ({ epoch, volume: s.volume, traders: s.traders.size, qualified: s.qualified }));
  }

  return {
    meta: legions.get(META_LEGION_ID)!,
    legions: [...legions.values()].filter((l) => l.id !== META_LEGION_ID).sort((a, b) => b.id - a.id),
    orders: [...offers.values(), ...bids.values()],
    qualifiedCounts,
    feed: ordered
      .slice(-FEED_LIMIT)
      .reverse()
      .map((e) => ({ txid: e.txid, event: e.event, blockHeight: e.block_height, data: e.data })),
  };
}
