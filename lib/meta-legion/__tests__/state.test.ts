import { describe, it, expect } from "vitest";
import { costOf, epochWindows, fmtPct, foldExchange, legionPhase, yesQuote, type Order } from "../state";
import { EXCHANGE_CONTRACT, TERMS, LEGION_STATUS, SIDE, PROOF_GRACE_BLOCKS } from "../constants";
import type { EventRow } from "../../legion/chainhook";

const terms = TERMS;

let n = 0;
function order(kind: Order["kind"], side: Order["side"], price: number, remaining = 5_000, legion = 0): Order {
  n += 1;
  return { id: n, kind, legion, side, maker: "SP1", price, remaining };
}

describe("epochWindows", () => {
  it("marks counted epochs upcoming, live, or done against the tip", () => {
    const tip = 491 * 2016 + 5;
    const w = epochWindows(terms, tip, { 490: 12, 491: 7 });
    expect(w.map((e) => e.state)).toEqual(["done", "live", "upcoming"]);
    expect(w.map((e) => e.qualifiedCount)).toEqual([12, 7, 0]);
    expect(w[0]).toMatchObject({ start: 987_840, end: 989_855 });
    expect(w[2].end + 1).toBe(terms.closeHeight);
  });

  it("treats every epoch as upcoming when the tip is unknown", () => {
    expect(epochWindows(terms, null, {}).every((e) => e.state === "upcoming")).toBe(true);
  });
});

describe("legionPhase", () => {
  const row = { id: 1, status: LEGION_STATUS.OPEN, deadline: 1_000 };
  const g = PROOF_GRACE_BLOCKS;

  it("walks trading, the proof window, then resolve-idle", () => {
    expect(legionPhase(row, 999, g)).toBe("trading");
    expect(legionPhase(row, 1_000, g)).toBe("proving");
    // resolve-bonded is accepted through deadline + grace, inclusive.
    expect(legionPhase(row, 1_000 + g, g)).toBe("proving");
    expect(legionPhase(row, 1_000 + g + 1, g)).toBe("idle");
  });

  it("settles the meta legion only by resolve-meta", () => {
    expect(legionPhase({ ...row, id: 0 }, 1_000 + g + 1, g)).toBe("resolvable");
  });

  it("reports settled outcomes", () => {
    expect(legionPhase({ ...row, status: LEGION_STATUS.YES }, 0, g)).toBe("yes");
    expect(legionPhase({ ...row, status: LEGION_STATUS.NO }, 0, g)).toBe("no");
  });
});

describe("yesQuote", () => {
  it("is empty with no orders", () => {
    expect(yesQuote([], 0)).toEqual({ bid: null, ask: null, mark: null });
  });

  it("folds the NO book into the YES quote as its complement", () => {
    const orders = [
      order("bid", SIDE.YES, 4_000),
      order("offer", SIDE.NO, 5_500), // a YES bid at 45%
      order("offer", SIDE.YES, 6_500),
      order("bid", SIDE.NO, 4_000), // a YES offer at 60%
      order("offer", SIDE.YES, 3_000, 0), // filled: ignored
      order("offer", SIDE.YES, 1_000, 5_000, 1), // another legion: ignored
    ];
    expect(yesQuote(orders, 0)).toEqual({ bid: 4_500, ask: 6_000, mark: 5_250 });
  });
});

describe("pricing", () => {
  it("rounds cost up like cost-of", () => {
    expect(costOf(10_000, 5_000)).toBe(5_000);
    expect(costOf(3, 5_000)).toBe(2);
  });

  it("formats price units as a percentage", () => {
    expect(fmtPct(5_000)).toBe("50%");
    expect(fmtPct(1_234)).toBe("12.3%");
    expect(fmtPct(null)).toBe("-");
  });
});

describe("foldExchange", () => {
  const A = "SP1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0";
  const B = "SP2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0";
  const C = "SP3CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC0";
  let tx = 0;
  const ev = (event: string, data: Record<string, unknown>, height: number, eventIndex = 0): EventRow => {
    tx += 1;
    return {
      txid: `0x${tx.toString(16).padStart(4, "0")}`,
      event_index: eventIndex,
      contract_id: EXCHANGE_CONTRACT,
      proposal_id: null,
      block_height: height,
      block_time: null,
      event,
      data: { event, ...data },
    };
  };
  const P2PKH = "0x76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac";
  const create = ev(
    "create-legion",
    { legion: 1, label: "Q?", scripts: [P2PKH], deadline: 995_000, "created-at": 968_124, creator: A },
    10
  );

  it("starts from legion 0 alone", () => {
    const f = foldExchange([], TERMS);
    expect(f.meta).toMatchObject({ id: 0, deadline: TERMS.closeHeight, scripts: [], status: LEGION_STATUS.OPEN });
    expect(f.legions).toEqual([]);
  });

  it("tracks collateral, the book, and counted volume", () => {
    const f = foldExchange(
      [
        create,
        ev("mint-set", { legion: 1, who: A, amount: 100_000 }, 11),
        ev("post-offer", { offer: 0, legion: 1, side: 1, maker: A, shares: 60_000, price: 5_000 }, 12),
        ev("fill-offer", { offer: 0, legion: 1, side: 1, taker: B, maker: A, shares: 50_000, gross: 25_000, fee: 500, epoch: 490 }, 13),
        ev("fill-offer", { offer: 0, legion: 1, side: 1, taker: TERMS.feeSink, maker: A, shares: 5_000, gross: 2_500, fee: 50, epoch: 490 }, 14),
        ev("merge-set", { legion: 1, who: A, amount: 10_000 }, 15),
      ],
      TERMS
    );
    const l = f.legions[0];
    expect(l).toMatchObject({
      id: 1,
      label: "Q?",
      scripts: [P2PKH],
      deadline: 995_000,
      createdAt: 968_124,
      collateral: 90_000,
      supply: 90_000,
    });
    expect(f.orders).toEqual([expect.objectContaining({ id: 0, kind: "offer", remaining: 5_000 })]);
    // The fee-sink fill moves the book but never the bar.
    expect(l.stats).toEqual([{ epoch: 490, volume: 25_000, traders: 2, qualified: false }]);
  });

  it("never counts the meta legion's own trading", () => {
    const f = foldExchange(
      [ev("fill-bid", { bid: 0, legion: 0, side: 0, taker: A, maker: B, shares: 90_000, gross: 60_000, fee: 1_200, epoch: 490 }, 5)],
      TERMS
    );
    expect(f.meta.stats).toEqual([]);
  });

  it("orders a post before its fill within one block, whatever the tx order", () => {
    const fill = ev("fill-bid", { bid: 3, legion: 1, side: 0, taker: A, maker: C, shares: 2_000, gross: 1_000, fee: 20, epoch: 490 }, 20, 0);
    const post = ev("post-bid", { bid: 3, legion: 1, side: 0, maker: C, shares: 5_000, price: 5_000, escrow: 2_500 }, 20, 4);
    const f = foldExchange([create, fill, post], TERMS);
    expect(f.orders).toEqual([expect.objectContaining({ id: 3, kind: "bid", remaining: 3_000 })]);
  });

  it("settles YES on a bond proof", () => {
    const f = foldExchange(
      [create, ev("resolve-bonded", { legion: 1, outcome: 1, staker: B, "bond-index": 0, sats: 100_000, by: C }, 30)],
      TERMS
    );
    expect(f.legions[0].status).toBe(LEGION_STATUS.YES);
  });

  it("takes qualification, counts and settlement from the prints", () => {
    const f = foldExchange(
      [
        create,
        ev("qualified", { legion: 1, epoch: 490, count: 1 }, 30),
        ev("resolve-idle", { legion: 1, outcome: 2, by: B }, 40),
        ev("resolve-meta", { count: 1, target: 50, outcome: 2, by: A }, 50),
        ev("cancel-offer", { offer: 9 }, 51),
      ],
      TERMS
    );
    expect(f.qualifiedCounts).toEqual({ 490: 1 });
    expect(f.legions[0].stats[0]).toMatchObject({ epoch: 490, qualified: true });
    expect(f.legions[0].status).toBe(LEGION_STATUS.NO);
    expect(f.meta.status).toBe(LEGION_STATUS.NO);
    expect(f.feed.map((e) => e.event)).toEqual(["cancel-offer", "resolve-meta", "resolve-idle", "qualified", "create-legion"]);
  });
});
