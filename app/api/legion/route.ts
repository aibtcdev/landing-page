// CACHE_INVARIANTS:POSTURE=public-only-get
// Read-only Legion dashboard snapshot (Stacks testnet). No auth, no per-caller
// branching. D1 is the source of truth (written by the 5-min cron); this
// endpoint reads it via getLegionSnapshot, which layers caches.default +
// singleflight on top (mirrors the leaderboard). Hiro is only hit on a
// stale/cold rebuild, never per request.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { getLegionSnapshot } from "@/lib/legion/read";
import {
  GOV_CONTRACT,
  GOV_RULES,
  PAYOUT_CONTRACT,
  TREASURY_CONTRACT,
} from "@/lib/legion/constants";

export const dynamic = "force-dynamic";

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/legion",
      method: "GET",
      description:
        "Read-only snapshot of the AIBTC Legion (Stacks testnet): treasury, members, and the full lifecycle of every governance proposal — including who voted and whether each proposal is passing. Built server-side on a cron, stored in D1, served from cache. Never accepts writes.",
      network: "stacks-testnet",
      contracts: {
        treasury: TREASURY_CONTRACT,
        gov: GOV_CONTRACT,
        payout: PAYOUT_CONTRACT,
      },
      governanceRules: GOV_RULES,
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseShape: {
        updatedAt: "number (unix ms)",
        blockHeight: "number | null (stacks tip at snapshot time)",
        treasury: "{ balance (sats), govWired, payoutWired, tokenWired }",
        totalStaked: "number | null (sats)",
        members: "Array<{ label, address, stake, weightPct, sbtcBalance }>",
        proposals:
          "Array<{ id, proposer, recipient, desc, amount, status, votes }> (newest first); status carries metQuorum/metThreshold/voterCount/vetoActivated/concluded/executed; votes is per-agent { voted, vote, amount }",
        errors: "string[] (per-read failures; partial snapshots are still served)",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const { env, ctx } = await getCloudflareContext();

  // Non-sensitive diagnostic: confirms whether the Hiro key + D1 actually reach
  // this deploy's code (reports presence only, never the value). Lets us tell
  // "key not set on this env" apart from a code bug without leaking secrets.
  if (searchParams.get("diag") === "1") {
    return NextResponse.json(
      {
        deployEnv: env.DEPLOY_ENV ?? null,
        hasHiroApiKey: Boolean(env.HIRO_API_KEY),
        hiroApiKeyLength: env.HIRO_API_KEY ? env.HIRO_API_KEY.length : 0,
        hasDb: Boolean(env.DB),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/legion" })
    : createConsoleLogger({ rayId, path: "/api/legion" });

  const snapshot = await getLegionSnapshot(env, ctx, logger);

  if (!snapshot) {
    // No D1 binding / nothing built yet — tell the client to retry, don't pin.
    return NextResponse.json(
      { error: "snapshot_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
    );
  }

  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
