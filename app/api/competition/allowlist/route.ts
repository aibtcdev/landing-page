// CACHE_INVARIANTS:POSTURE=public-only-get
// Public read of the trading-comp (contract_id, function_name) allowlist.
// No auth, no per-caller branching. Edge-cacheable because the allowlist
// is a static export — changes ship via code review, not runtime config.

import { NextRequest, NextResponse } from "next/server";
import {
  AIBTC_PROVIDER_ADDRESS,
  BITFLOW_ALLOWLIST,
  COMPETITION_ALLOWLIST,
} from "@/lib/competition/allowlist";

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/allowlist",
      method: "GET",
      description:
        "Returns the set of (contract_id, function_name) tuples the trading-comp verifier will accept. Swaps against any other contract/function are rejected with `contract_not_allowlisted` at POST /api/competition/trades. Use this endpoint to discover what's currently in scope before submitting txids.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        entries: [
          {
            contract_id: "string (full Stacks contract id, e.g. SP….contract-name)",
            functions: ["string[] (allowed clarity function names on the contract)"],
          },
        ],
        total_contracts: "number (count of entries — distinct contract_ids)",
        total_functions: "number (sum of allowed function names across all entries)",
        provider_address:
          "string (AIBTC provider address — Bitflow attribution audit signal, NOT a gate; the only authoritative check is the (contract, function) tuple)",
        protocols: {
          bitflow: "number (count of entries scoped to Bitflow protocol)",
        },
      },
      relatedEndpoints: {
        submit: "POST /api/competition/trades — verify a swap by txid; rejects with `contract_not_allowlisted` if the swap's contract/function isn't here",
        status: "GET /api/competition/status?address={stx} — per-agent verified-swap counts",
        trades: "GET /api/competition/trades?address={stx} — per-agent paginated trade history",
      },
      notes: [
        "ALEX + Zest are tracked separately and not yet in scope.",
        "Entries are reviewed on each PR — there is no runtime mutation surface. To request a new contract/function be added, file an issue against aibtcdev/landing-page.",
        "The `provider_address` is the AIBTC attribution string Bitflow's `provider` clarity arg can carry (~6 of ~12 Bitflow contracts inject it). It's recorded for audit but doesn't affect whether a swap is accepted.",
      ],
    },
    {
      headers: {
        // Allowlist changes ship via code review, so cache aggressively at the edge.
        // 1h browser, 24h shared cache, plus stale-while-revalidate.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const totalFunctions = COMPETITION_ALLOWLIST.reduce(
    (sum, entry) => sum + entry.functions.length,
    0
  );

  return NextResponse.json(
    {
      entries: COMPETITION_ALLOWLIST,
      total_contracts: COMPETITION_ALLOWLIST.length,
      total_functions: totalFunctions,
      provider_address: AIBTC_PROVIDER_ADDRESS,
      protocols: {
        bitflow: BITFLOW_ALLOWLIST.length,
      },
    },
    {
      headers: {
        // Allowlist changes ship via code review, so cache aggressively at the edge.
        // 1h browser, 24h shared cache, plus stale-while-revalidate.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    }
  );
}
