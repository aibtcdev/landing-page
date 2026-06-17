// CACHE_INVARIANTS:POSTURE=public-only-get
// Read-only Legion dashboard snapshot. No auth, no per-caller branching.
// Data is built by the cron (lib/scheduler/cron-runner.ts → runLegionNow) and
// stored in KV; this endpoint serves that blob behind an edge cache. The first
// visitor after a cold start (empty KV) builds it inline once, then the cron
// keeps it warm — so Hiro is hit at most once per refresh window regardless of
// traffic.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { withEdgeCache } from "@/lib/edge-cache";
import {
  buildLegionSnapshot,
  readLegionSnapshot,
  writeLegionSnapshot,
} from "@/lib/legion/snapshot";
import {
  GOV_CONTRACT,
  GOV_RULES,
  PAYOUT_CONTRACT,
  TREASURY_CONTRACT,
} from "@/lib/legion/constants";

const EDGE_CACHE_KEY = "https://cache.aibtc.local/api/legion";
// Edge + client TTL. Data only changes when the 5-min cron rewrites the blob,
// so a 60s edge window caps KV reads without ever serving stale-by-much data.
const TTL_SECONDS = 60;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/legion",
      method: "GET",
      description:
        "Read-only snapshot of the AIBTC Legion (Stacks testnet): treasury, members, and the full lifecycle of every governance proposal. Built server-side on a cron and served from cache — this endpoint never accepts writes.",
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
          "Array<{ id, proposer, recipient, desc, amount, status, votes }> (newest first)",
        errors: "string[] (per-read failures; partial snapshots are still served)",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  return withEdgeCache(EDGE_CACHE_KEY, TTL_SECONDS, async () => {
    const { env, ctx } = await getCloudflareContext();
    const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, { rayId, path: "/api/legion" })
      : createConsoleLogger({ rayId, path: "/api/legion" });

    const kv = env.LEGION as KVNamespace | undefined;
    if (!kv) {
      // No KV binding — can't serve or cache. Tell the client to retry, don't pin.
      return NextResponse.json(
        { error: "transient_kv_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
      );
    }

    let snapshot = await readLegionSnapshot(kv);

    // Cold start: KV empty before the first cron tick. Build once inline and
    // persist so the next reader (and the edge) is warm.
    if (!snapshot) {
      logger.info("legion.cold_build");
      snapshot = await buildLegionSnapshot(logger);
      const stash = writeLegionSnapshot(kv, snapshot);
      if (ctx) ctx.waitUntil(stash);
      else await stash;
    }

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": `public, max-age=${TTL_SECONDS}, s-maxage=${TTL_SECONDS}`,
      },
    });
  });
}
