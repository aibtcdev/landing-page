"use client";

/**
 * The /meta-legion page: legion 0 of the Legion Exchange, its scoreboard and
 * its market. Styled with the /legions `.nl` system (legions.css) plus the
 * handful of pieces that page has no use for (meta-legion.css).
 *
 * Every figure is folded from the exchange's own print events, delivered by
 * chainhook (lib/meta-legion/state.ts). Trading is done by calling the contract
 * directly, which the "How to trade" block spells out.
 */

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { swrKeys } from "@/lib/swr-keys";
import type { MetaLegionState } from "@/lib/meta-legion/server-state";
import {
  EXCHANGE_CONTRACT,
  EXCHANGE_EXPLORER_HREF,
  LEGION_STATUS,
  SIDE,
  type Side,
} from "@/lib/meta-legion/constants";
import {
  bookFor,
  fmtPct,
  legionPhase,
  yesQuote,
  type EpochWindow,
  type FeedItem,
  type LegionPhase,
  type LegionRow,
  type Order,
} from "@/lib/meta-legion/state";
import { describeScript } from "@/lib/meta-legion/scripts";
import {
  contractLink,
  fmtBlocksLeft,
  fmtClock,
  fmtInt,
  fmtSats,
  shortAddr,
  txLink,
} from "@/lib/legion/format";

const PHASE_LABEL: Record<LegionPhase, string> = {
  trading: "Trading",
  proving: "Proof window",
  idle: "Awaiting resolve-idle",
  resolvable: "Resolvable",
  yes: "Bonded, YES",
  no: "Idle, NO",
};

const PHASE_TONE: Record<LegionPhase, string> = {
  trading: "live",
  proving: "warn",
  idle: "warn",
  resolvable: "warn",
  yes: "good",
  no: "bad",
};

const SIDE_LABEL: Record<Side, string> = { [SIDE.YES]: "YES", [SIDE.NO]: "NO" };

// ─────────────────────────────────────────────────────────────────────────────
// The clock: counts to the meta close, anchored to the tip block's timestamp so
// every viewer sees the same figure and a reload does not restart it.
// ─────────────────────────────────────────────────────────────────────────────

function CloseClock({ state }: { state: MetaLegionState }) {
  const { tip, tipTime, blockSeconds, terms, epochs } = state;
  const blocksLeft = tip == null ? null : Math.max(0, terms.closeHeight - tip);
  const deadlineAt = tipTime != null && blocksLeft != null ? tipTime + blocksLeft * blockSeconds : null;
  const [left, setLeft] = useState(() => (blocksLeft == null ? 0 : blocksLeft * blockSeconds));
  useEffect(() => {
    if (deadlineAt == null) return;
    const sync = () => setLeft(Math.max(0, deadlineAt - Math.floor(Date.now() / 1000)));
    sync();
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  }, [deadlineAt]);

  const closed = blocksLeft === 0;
  return (
    <div className="clock">
      <div className="clock-head">
        <span className="live">{closed ? "Closed" : "Until the close"}</span>
        <span>Block {fmtInt(tip)}</span>
      </div>
      {blocksLeft == null ? (
        <div className="clock-t idle">Tip unavailable</div>
      ) : closed ? (
        <div className="clock-t idle">Anyone can resolve</div>
      ) : (
        <div className="clock-t">
          <span className="approx" aria-hidden="true">
            ~
          </span>
          {fmtClock(left)}
        </div>
      )}
      <div className="clock-sub">
        {closed ? (
          <>
            <b>resolve-meta</b> settles legion 0 from the scoreboard. Same answer whoever calls it.
          </>
        ) : (
          <>
            <b>{fmtInt(blocksLeft)}</b> burn blocks to <b>{fmtInt(terms.closeHeight)}</b>
            <br />
            Estimated at ~{Math.round(blockSeconds / 60)} min per Bitcoin block.
          </>
        )}
      </div>
      <div className="clock-rail" style={{ gridTemplateColumns: `repeat(${epochs.length}, 1fr)` }}>
        {epochs.map((e) => {
          const pct =
            tip == null ? 0 : Math.max(0, Math.min(100, ((tip - e.start) / (e.end - e.start + 1)) * 100));
          const cls = e.state === "done" ? "done" : e.state === "live" ? "now" : "";
          return (
            <div className={`rail-seg ${cls}`} key={e.epoch} title={`Epoch ${e.epoch}: ${e.start} to ${e.end}`}>
              <span className="rail-track">
                <span className="rail-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="rail-l">Epoch {e.epoch}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoreboard
// ─────────────────────────────────────────────────────────────────────────────

function EpochCard({ e, target }: { e: EpochWindow; target: number }) {
  const n = e.qualifiedCount;
  const pct = n == null ? 0 : Math.min(100, (n / target) * 100);
  return (
    <div className={`ml-epoch ${e.state}`}>
      <div className="ml-epoch-head">
        <span>Epoch {e.epoch}</span>
        <span className="ml-epoch-state">
          {e.state === "live" ? "Counting now" : e.state === "done" ? "Final" : "Not started"}
        </span>
      </div>
      <div className="ml-epoch-v">
        {n == null ? "-" : fmtInt(n)}
        <em>/ {fmtInt(target)} legions</em>
      </div>
      <span className="rail-track">
        <span className="rail-fill" style={{ width: `${pct}%` }} />
      </span>
      <div className="ml-epoch-sub">
        Burn {fmtInt(e.start)} to {fmtInt(e.end)}
      </div>
    </div>
  );
}

/** The addresses a legion asks about. They, not the label, decide the answer. */
function Addresses({ scripts }: { scripts: string[] }) {
  return (
    <ul className="ml-addrs">
      {scripts.map((sc) => {
        const v = describeScript(sc);
        return (
          <li key={sc} title={sc}>
            {v.address ? (
              <a href={`https://mempool.space/address/${v.address}`} target="_blank" rel="noopener">
                {v.address}
              </a>
            ) : (
              v.label
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The deadline cell: trading countdown, then the proof window's. */
function DeadlineCell({ l, state }: { l: LegionRow; state: MetaLegionState }) {
  const { tip, terms, blockSeconds } = state;
  const toDeadline = tip == null ? null : l.deadline - tip;
  const proofEnd = l.deadline + terms.proofGrace;
  const toProofEnd = tip == null ? null : proofEnd - tip;
  return (
    <td className="ml-mono">
      {fmtInt(l.deadline)}
      {toDeadline != null && toDeadline > 0 ? (
        <span className="ml-dim"> {fmtBlocksLeft(toDeadline, blockSeconds)}</span>
      ) : null}
      <span className="ml-sub-line">
        YES provable to {fmtInt(proofEnd)}
        {toDeadline != null && toDeadline <= 0 && toProofEnd != null && toProofEnd >= 0
          ? ` (${fmtBlocksLeft(toProofEnd, blockSeconds)})`
          : ""}
      </span>
    </td>
  );
}

function LegionTable({ state, legions }: { state: MetaLegionState; legions: LegionRow[] }) {
  const { tip, terms, currentEpoch } = state;
  return (
    <div className="ml-table-wrap">
      <table className="ml-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Deadline</th>
            <th>Status</th>
            <th className="num">Epoch {currentEpoch ?? "-"} volume</th>
            <th className="num">Traders</th>
            <th>Bar</th>
          </tr>
        </thead>
        <tbody>
          {legions.map((l) => {
            const phase = legionPhase(l, tip, terms.proofGrace);
            const now = l.stats.find((s) => s.epoch === currentEpoch);
            const stopsEarly = l.deadline < terms.closeHeight;
            return (
              <tr key={l.id}>
                <td className="ml-mono ml-dim">{l.id}</td>
                <td className="q">
                  <span className="ml-q-label">{l.label}</span>
                  <Addresses scripts={l.scripts} />
                  {stopsEarly && phase === "trading" ? (
                    <span className="ml-flag" title={`Trading stops before burn ${fmtInt(terms.closeHeight - 1)}`}>
                      Closes before the meta legion, does not count
                    </span>
                  ) : null}
                </td>
                <DeadlineCell l={l} state={state} />
                <td>
                  <span className={`ml-pill ${PHASE_TONE[phase]}`}>{PHASE_LABEL[phase]}</span>
                </td>
                <td className="ml-mono num">
                  {fmtInt(now?.volume ?? 0)}
                  <span className="ml-dim"> / {fmtInt(terms.minVolume)}</span>
                </td>
                <td className="ml-mono num">
                  {fmtInt(now?.traders ?? 0)}
                  <span className="ml-dim"> / {terms.minTraders}</span>
                </td>
                <td>
                  <span className={`ml-pill ${now?.qualified ? "good" : "dim"}`}>
                    {now?.qualified ? "Qualified" : "Not yet"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The meta legion's market
// ─────────────────────────────────────────────────────────────────────────────

function BookSide({ label, orders, kind }: { label: string; orders: Order[]; kind: "ask" | "bid" }) {
  return (
    <div className="ml-book-col">
      <div className={`ml-book-label ${kind}`}>{label}</div>
      {orders.length === 0 ? (
        <div className="ml-book-empty">None open</div>
      ) : (
        <ol className="ml-book-list">
          {orders.slice(0, 8).map((o) => (
            <li key={`${o.kind}-${o.id}`}>
              <span className="p">{fmtPct(o.price)}</span>
              <span className="s">{fmtInt(o.remaining)} sh</span>
              <span className="id">
                {o.kind} #{o.id}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MetaMarket({ state }: { state: MetaLegionState }) {
  const { meta, orders, terms, tip } = state;
  const quote = yesQuote(orders, 0);
  const room = Math.max(0, terms.maxCollateral - meta.collateral);
  const phase = legionPhase(meta, tip, terms.proofGrace);
  const sides: Side[] = [SIDE.YES, SIDE.NO];

  return (
    <section className="ml-section">
      <h2 className="ml-h2">The meta market</h2>

      <div className="figs four">
        <div className="fig accent">
          <span className="l">YES price</span>
          <span className="v">{quote.mark == null ? "No price" : fmtPct(quote.mark)}</span>
        </div>
        <div className="fig">
          <span className="l">Best YES bid / ask</span>
          <span className="v">
            {fmtPct(quote.bid)} <em>/</em> {fmtPct(quote.ask)}
          </span>
        </div>
        <div className="fig">
          <span className="l">Collateral locked</span>
          <span className="v">
            {fmtInt(meta.collateral)}
            <em>sats</em>
          </span>
        </div>
        <div className="fig">
          <span className="l">Room under the cap</span>
          <span className="v">
            {fmtInt(room)}
            <em>of {fmtInt(terms.maxCollateral)}</em>
          </span>
        </div>
      </div>

      <div className="ml-book">
        {sides.map((side) => {
          const book = bookFor(orders, 0, side);
          return (
            <div className="ml-book-side" key={side}>
              <div className="ml-book-title">{SIDE_LABEL[side]} shares</div>
              <div className="ml-book-grid">
                <BookSide label="Offers (sell)" orders={book.asks} kind="ask" />
                <BookSide label="Bids (buy)" orders={book.bids} kind="bid" />
              </div>
            </div>
          );
        })}
      </div>
      {phase !== "trading" ? (
        <div className="notice">
          <b>{PHASE_LABEL[phase]}.</b> Trading on legion 0 has stopped. Cancelling and merging still work.
        </div>
      ) : null}
      <HowToTrade state={state} />
    </section>
  );
}

function HowToTrade({ state }: { state: MetaLegionState }) {
  const { terms } = state;
  const calls: { fn: string; args: string; what: string; pc: string }[] = [
    {
      fn: "mint-set",
      args: "u0, amount",
      what: "Lock sats, get one YES and one NO share per sat",
      pc: "You send exactly amount sBTC",
    },
    {
      fn: "post-offer",
      args: "u0, side, shares, price",
      what: "Sell shares you hold at a price",
      pc: "None",
    },
    {
      fn: "fill-offer",
      args: "id, shares",
      what: "Buy from an open offer",
      pc: "You send exactly cost-of(shares, price)",
    },
    {
      fn: "post-bid",
      args: "u0, side, shares, price",
      what: "Escrow sats to buy at a price",
      pc: "You send exactly cost-of(shares, price)",
    },
    {
      fn: "fill-bid",
      args: "id, shares",
      what: "Sell into an open bid",
      pc: "Exchange sends exactly cost-of(shares, price)",
    },
    {
      fn: "merge-set",
      args: "u0, amount",
      what: "Return one YES + one NO, get a sat back",
      pc: "Exchange sends exactly amount",
    },
    {
      fn: "redeem",
      args: "u0",
      what: "After resolution, collect the winning side",
      pc: "Exchange sends exactly claimable(u0, you)",
    },
    {
      fn: "resolve-meta",
      args: "none",
      what: "After the close, settle legion 0 from the scoreboard (anyone)",
      pc: "None",
    },
  ];
  return (
    <div className="ml-howto">
      <div className="ml-howto-head">
        <span>How to trade</span>
        <a href={contractLink(EXCHANGE_CONTRACT)} target="_blank" rel="noopener">
          {shortAddr(EXCHANGE_CONTRACT)}
        </a>
      </div>
      <p className="ml-howto-note">
        Post-condition <b>deny</b> mode. <code>side</code> <code>u1</code> YES, <code>u0</code> NO.{" "}
        <code>price</code> <code>u5000</code> = 50%. {terms.feeBps / 100}% fee from the maker, 1,000 sat minimum.
      </p>
      <div className="ml-table-wrap">
        <table className="ml-table ml-calls">
          <thead>
            <tr>
              <th>Function</th>
              <th>Args</th>
              <th>Does</th>
              <th>sBTC post-condition</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.fn}>
                <td className="ml-mono ml-accent">{c.fn}</td>
                <td className="ml-mono">{c.args}</td>
                <td>{c.what}</td>
                <td className="ml-dim">{c.pc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire
// ─────────────────────────────────────────────────────────────────────────────

const legionRef = (d: Record<string, unknown>) => {
  const id = Number(d.legion);
  return id === 0 ? "the meta legion" : `legion #${id}`;
};

function wireLine(e: FeedItem): React.ReactNode {
  const d = e.data;
  const who = (k: string) => <b>{shortAddr(d[k] as string)}</b>;
  const side = Number(d.side) === SIDE.YES ? "YES" : "NO";
  switch (e.event) {
    case "create-legion":
      return (
        <>
          {who("creator")} created <b>legion #{Number(d.legion)}</b>
        </>
      );
    case "mint-set":
      return (
        <>
          {who("who")} minted {fmtInt(Number(d.amount))} sets on {legionRef(d)}
        </>
      );
    case "merge-set":
      return (
        <>
          {who("who")} merged {fmtInt(Number(d.amount))} sets on {legionRef(d)}
        </>
      );
    case "post-offer":
      return (
        <>
          {who("maker")} offered {fmtInt(Number(d.shares))} {side} at {fmtPct(Number(d.price))} on {legionRef(d)}
        </>
      );
    case "post-bid":
      return (
        <>
          {who("maker")} bid for {fmtInt(Number(d.shares))} {side} at {fmtPct(Number(d.price))} on {legionRef(d)}
        </>
      );
    case "fill-offer":
    case "fill-bid":
      return (
        <>
          {who("taker")} {e.event === "fill-offer" ? "bought" : "sold"} {fmtInt(Number(d.shares))} {side} for{" "}
          {fmtSats(Number(d.gross))} on {legionRef(d)}
        </>
      );
    case "cancel-offer":
      return <>offer #{Number(d.offer)} cancelled</>;
    case "cancel-bid":
      return <>bid #{Number(d.bid)} cancelled</>;
    case "qualified":
      return (
        <>
          <b>legion #{Number(d.legion)}</b> cleared the bar in epoch {Number(d.epoch)} ({Number(d.count)} this epoch)
        </>
      );
    case "resolve-bonded":
      return (
        <>
          {who("by")} proved a bond: {legionRef(d)} settled <b>YES</b>
        </>
      );
    case "resolve-idle":
      return (
        <>
          {who("by")} settled {legionRef(d)} <b>NO</b>, no bond proven
        </>
      );
    case "resolve-meta":
      return (
        <>
          the meta legion resolved <b>{Number(d.outcome) === 1 ? "YES" : "NO"}</b> at {Number(d.count)} /{" "}
          {Number(d.target)}
        </>
      );
    case "redeem":
      return (
        <>
          {who("who")} redeemed {fmtSats(Number(d.payout))} from {legionRef(d)}
        </>
      );
    case "transfer-shares":
      return (
        <>
          {who("from")} sent {fmtInt(Number(d.amount))} {side} to {who("to")}
        </>
      );
    default:
      return e.event;
  }
}

function Wire({ feed }: { feed: FeedItem[] }) {
  return (
    <aside className="wire">
      <div className="wire-head">
        <span>Recent activity</span>
      </div>
      {feed.length === 0 ? (
        <p className="wire-empty">Nothing on the wire yet.</p>
      ) : (
        <ul className="wire-list">
          {feed.map((e, i) => (
            <li key={`${e.txid}-${e.event}-${i}`}>
              <a
                className="wire-line"
                href={txLink(e.txid)}
                target="_blank"
                rel="noopener"
                title={`Stacks block ${fmtInt(e.blockHeight)}, open the transaction`}
              >
                {wireLine(e)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

type Filter = "all" | "trading" | "qualified" | "settled";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  trading: "Trading",
  qualified: "Qualified this epoch",
  settled: "Settled",
};

function CtaBand({ t, d }: { t: string; d: string }) {
  return (
    <div className="cta-band">
      <div>
        <div className="t">{t}</div>
        <div className="d">{d}</div>
      </div>
      <a className="cta-btn" href={EXCHANGE_EXPLORER_HREF} target="_blank" rel="noopener">
        Read the contract
      </a>
    </div>
  );
}

export default function MetaLegionView({ initial }: { initial: MetaLegionState | null }) {
  const { data, error } = useSWR<MetaLegionState>(swrKeys.metaLegion(), {
    refreshInterval: 60_000,
    dedupingInterval: 60_000,
    fallbackData: initial ?? undefined,
  });
  const [filter, setFilter] = useState<Filter>("all");

  // The bar gets a solid ground only once it is actually stuck under the
  // Navbar, i.e. when the sentinel just above it leaves the viewport.
  const barSentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = barSentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: "-70px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [data]);

  if (!data) {
    return (
      <main className="content">
        {error ? (
          <div className="err">Could not read the exchange. Retrying…</div>
        ) : (
          <div className="empty">
            <span className="sk" style={{ width: 180 }} />
          </div>
        )}
      </main>
    );
  }

  const { terms, score, meta, legions, currentEpoch, tip } = data;
  const qualifiedNow = (l: LegionRow) => l.stats.some((s) => s.epoch === currentEpoch && s.qualified);
  const groups: Record<Filter, LegionRow[]> = {
    all: legions,
    trading: legions.filter((l) => legionPhase(l, tip, terms.proofGrace) === "trading"),
    qualified: legions.filter(qualifiedNow),
    settled: legions.filter((l) => l.status !== LEGION_STATUS.OPEN),
  };
  const shown = groups[filter];

  return (
    <main className="content">
      {tip == null ? (
        <div className="notice">
          <b>Chain read failed.</b> Epochs and countdowns are unavailable until the next refresh. Every indexed
          event is still shown.
        </div>
      ) : null}
      {!data.complete ? (
        <div className="notice">
          <b>Event store unavailable.</b> Figures below may be incomplete.
        </div>
      ) : null}

      <section className="hero">
        <div>
          <span className="hero-kicker">Legion Exchange · Legion 0</span>
          <h1 className="hero-h1">
            Will <em>{terms.target} legions</em>{" "}
            <br />
            trade?
          </h1>
          <p className="hero-lede">
            YES if {terms.target} legions each trade {fmtSats(terms.minVolume)} among {terms.minTraders} traders in
            all three counted epochs. The contract settles it from its own scoreboard.
          </p>
          <div className="hero-cta">
            <a className="cta-btn" href={EXCHANGE_EXPLORER_HREF} target="_blank" rel="noopener">
              Read the contract
            </a>
            <a className="aside" href="/api/meta-legion?docs=1">
              API docs
            </a>
          </div>
        </div>
        <CloseClock state={data} />
      </section>

      <div className="stat-row">
        <div className="stat-tile wide accent">
          <span className="v">
            {fmtInt(score)} / {fmtInt(terms.target)}
          </span>
          <span className="l">Meta score</span>
        </div>
        <div className="stat-tile">
          <span className="v">{fmtInt(legions.length)}</span>
          <span className="l">Legions</span>
        </div>
        <div className="stat-tile good">
          <span className="v">{fmtInt(groups.qualified.length)}</span>
          <span className="l">Qualified this epoch</span>
        </div>
        <div className="stat-tile">
          <span className="v">{fmtInt(currentEpoch)}</span>
          <span className="l">Current epoch</span>
        </div>
        <div className="stat-tile">
          <span className="v">{fmtPct(yesQuote(data.orders, 0).mark)}</span>
          <span className="l">YES price</span>
        </div>
      </div>

      <section className="ml-section">
        <h2 className="ml-h2">Scoreboard</h2>
        <div className="ml-epochs">
          {data.epochs.map((e) => (
            <EpochCard key={e.epoch} e={e} target={terms.target} />
          ))}
        </div>
      </section>

      <div ref={barSentinel} className="legion-bar-sentinel" aria-hidden="true" />
      <div className={`legion-bar ${stuck ? "stuck" : ""}`}>
        <CtaBand
          t="Anyone can create a legion."
          d={`${fmtSats(terms.minVolume)} among ${terms.minTraders} traders per epoch to qualify`}
        />
        {legions.length ? (
          <div className="tabs">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className="tab"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
                <span className="count">{groups[f].length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          {legions.length === 0
            ? "No legions yet besides the meta legion. Anyone can create one."
            : `No ${FILTER_LABEL[filter].toLowerCase()} legions.`}
        </div>
      ) : (
        <LegionTable state={data} legions={shown} />
      )}

      <MetaMarket state={data} />

      <Wire feed={data.feed} />

      <div className="cta-close">
        <div className="t">Put a legion on the board</div>
        <p className="d">
          Up to {terms.maxScripts} Bitcoin addresses and a deadline. Call <code>create-legion</code> and let it trade.
        </p>
        <a className="cta-btn" href={EXCHANGE_EXPLORER_HREF} target="_blank" rel="noopener">
          Read the contract
        </a>
      </div>
    </main>
  );
}
