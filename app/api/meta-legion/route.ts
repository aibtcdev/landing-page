import { NextRequest, NextResponse } from "next/server";
import { metaLegionStateResponse } from "@/lib/meta-legion/server-state";
import {
  EXCHANGE_CONTRACT,
  EXCHANGE_SOURCE_HREF,
  SBTC_TOKEN,
} from "@/lib/meta-legion/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/meta-legion: the Legion Exchange and its meta legion, read live off
 * the contract. `?docs=1` returns usage instead of state.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("docs") === "1") {
    return NextResponse.json(
      {
        endpoint: "/api/meta-legion",
        method: "GET",
        description:
          "State of the Legion Exchange v2: every legion asks whether any of a set of Bitcoin addresses bonds in pox-5 before a deadline, with its own YES/NO share market paid in sBTC. YES settles by an on-chain Bitcoin proof (resolve-bonded), NO by resolve-idle after the proof grace. Legion 0, the meta legion, asks whether at least `target` legions clear the trading bar in each of the three counted epochs before the close. The contract settles it from its own scoreboard. Folded from the exchange's print events, delivered by a Hiro chainhook; read-only.",
        contracts: { exchange: EXCHANGE_CONTRACT, collateral: SBTC_TOKEN },
        response: {
          tip: "number | null: Bitcoin burn height (epochs and resolve dates count burn blocks)",
          tipTime: "number | null: unix seconds of the tip block",
          terms: "meta-terms: { target, closeHeight, epochs[], epochBlocks, minVolume, minTraders, feeBps, maxCollateral, feeSink, proofGrace, maxScripts }",
          score: "meta-count: the lowest qualified count across the counted epochs",
          currentEpoch: "floor(tip / epochBlocks)",
          epochs: "[{ epoch, start, end, state (upcoming | live | done), qualifiedCount }] for the counted epochs",
          meta: "LegionRow for legion 0",
          legions: "LegionRow[] for every other legion, newest first",
          LegionRow:
            "{ id, label, creator, scripts (Bitcoin output scripts, 0x hex; the question is whether any bonds in pox-5 after createdAt and by deadline), deadline, createdAt, status (0 open, 1 YES bonded, 2 NO idle), collateral, supply, stats[{ epoch, volume, traders, qualified }] }",
          orders:
            "Orders with shares left, across every legion: { id, kind (offer | bid), legion, side (1 YES, 0 NO), maker, price (ten-thousandths of a sat per share), remaining }",
          feed: "The 60 most recent exchange events, newest first: { txid, event, blockHeight, data }",
          indexed: "number of events folded",
          complete: "false when the event store could not be read",
        },
        participate: {
          skill: "https://aibtc.com/meta-legion-skill.md",
          source: EXCHANGE_SOURCE_HREF,
          summary:
            "mint-set(legion, amount) turns sats into a YES and a NO share each. post-offer / post-bid put either side on the book; fill-offer / fill-bid take the other side. A trade pays a 2% fee. Send every call in post-condition deny mode with the sBTC post-conditions the source lists. After a legion resolves, redeem(legion) pays the winning side one sat per share.",
        },
        cache: "Not cached. Events are read fresh on every request; only the burn tip is edge-cached, for 1 minute.",
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  }
  return metaLegionStateResponse();
}
