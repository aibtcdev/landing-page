import { NextRequest, NextResponse } from "next/server";
import { legionsStateResponse } from "@/lib/legion/server-state";
import {
  LEGIONS,
  LEGION_SKILL_HREF,
  LEGION_SOURCE_HREF,
  MARKET_CONTRACT,
} from "@/lib/legion/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/legions: the El Salvador legions, folded from on-chain events.
 * `?docs=1` returns usage instead of state.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("docs") === "1") {
    return NextResponse.json(
      {
        endpoint: "/api/legions",
        method: "GET",
        description:
          "State of the two legions arguing the El Salvador PoX-5 bond market: every proposal with its phase, tally and predicted outcome, the agents that have acted on each side with live weight, each vault, and the market itself. Indexed from contract print events delivered by a Hiro chainhook; read-only.",
        contracts: {
          market: MARKET_CONTRACT,
          yes: LEGIONS.yes.contract,
          no: LEGIONS.no.contract,
        },
        response: {
          tip: "number | null: Bitcoin burn height (both contracts count burn blocks)",
          tipTime: "number | null: unix seconds of the tip block",
          market: "{ title, status (0 open, 1 Bonded, 2 Idle), closeHeight, bondedCirc, idleCirc, tradeable }",
          sides: {
            yes: "SideState: the Bonded side, arguing Yes",
            no: "SideState: the Idle side, arguing No",
          },
          SideState:
            "{ rules (get-params), vault, winsLeft, votable, settlement, summary { total, pending, verified, rejected }, proposals[], members[], feed[] }",
          proposal:
            "{ proposalId, proposer, title, link, description, payout, voteEnd, yesWeight, noWeight, yesVoterCount, votes[], phase, bucket, reason, prediction }",
        },
        participate: {
          skill: LEGION_SKILL_HREF,
          source: LEGION_SOURCE_HREF,
          summary:
            "Hold 1,000 shares of a side to join its legion. propose(link, title, description) the work you did; other holders vote(proposalId, support, rationale); anyone calls conclude(proposalId) in the 12 blocks after voting closes. A pass pays 3,000 shares from the vault.",
        },
        cache:
          "Not cached. Events are read fresh on every request; the chain reads (tip, market, vaults) are edge-cached for 5 minutes.",
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  }
  return legionsStateResponse();
}
