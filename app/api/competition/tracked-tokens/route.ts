// CACHE_INVARIANTS:POSTURE=public-only-get
// Public read of the dynamic token set the SchedulerDO refreshes Tenero
// prices for. Derived from the `swaps` table on each request — see
// `lib/external/tenero/tokens.ts:getActiveTokenIds`. Read-only, no auth.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  STATIC_TOKEN_IDS,
  MAX_TRACKED_TOKENS,
  getActiveTokenIds,
} from "@/lib/external/tenero";

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/tracked-tokens",
      method: "GET",
      description:
        "The Tenero refresh set the SchedulerDO uses on each tick. Union of the always-include static core and distinct token_in / token_out from successful agent/cron swaps in D1, junk-filtered for shape, ranked by trade count, capped at MAX_TRACKED_TOKENS. Falls back to the static core on D1 query failure.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        tokens: "string[] — the active set (static core ∪ dynamic discovery)",
        count: "number — length of tokens",
        source:
          "'dynamic' when D1 derivation succeeded, 'static-fallback' on failure or missing binding",
        staticCore: "string[] — the always-include core that backs the fallback",
        maxTracked: "number — upper bound on dynamic discovery per tick (MAX_TRACKED_TOKENS)",
      },
      relatedEndpoints: {
        allowlist:
          "GET /api/competition/allowlist — contracts + functions the verifier will accept",
        prices: "GET /api/prices — cached USD prices for the static core only",
      },
      notes: [
        "Dynamic discovery falls back to STATIC_TOKEN_IDS when there's no DB binding or the query throws.",
        "Tokens are ordered with the static core first, then dynamic entries by descending trade count.",
        "The set is recomputed on each SchedulerDO tick (5 min cadence); this endpoint reports what the *next* tick would use.",
      ],
    },
    {
      headers: {
        // 1 min browser, 1 min shared — the set can shift as agents trade.
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const { env } = await getCloudflareContext({ async: true });
  const db = env.DB as D1Database | undefined;
  const tokens = await getActiveTokenIds(db);

  // `getActiveTokenIds` falls back to STATIC_TOKEN_IDS on any failure; we
  // can't distinguish "fallback" from "static core happened to win" without
  // a side-channel, so the heuristic is: if the result has more tokens than
  // the static core, dynamic discovery added something; if it equals the
  // core exactly we couldn't add anything (could be empty table OR DB error
  // — both are functionally "static-fallback" from a consumer perspective).
  const source: "dynamic" | "static-fallback" =
    tokens.length > STATIC_TOKEN_IDS.length ? "dynamic" : "static-fallback";

  return NextResponse.json(
    {
      tokens,
      count: tokens.length,
      source,
      staticCore: STATIC_TOKEN_IDS,
      maxTracked: MAX_TRACKED_TOKENS,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );
}
