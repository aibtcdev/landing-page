// CACHE_INVARIANTS:POSTURE=public-only-get
// Read-only detail for one Legion (Stacks testnet). No auth. Resolves the id to
// its registry entry, then serves the matching snapshot type — demand (treasury
// + proposals + votes) or provider (bonds + jobs). D1 is the source of truth
// (cron-written); reads layer caches.default + singleflight (see
// lib/legion/read.ts). Hiro is only hit on a stale/cold rebuild.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  getLegionSnapshot,
  getProviderSnapshot,
  resolveLegionEntry,
} from "@/lib/legion/read";
import { REGISTRY_CONTRACT } from "@/lib/legion/constants";

export const dynamic = "force-dynamic";

function selfDocResponse(id: string) {
  return NextResponse.json(
    {
      endpoint: `/api/legions/${id}`,
      method: "GET",
      description:
        "Read-only snapshot of one AIBTC Legion (Stacks testnet). The shape depends on `entry.kind`: a demand Legion returns treasury, members, and the full lifecycle of every governance proposal; a provider Legion returns the treasury, min bond, and every registered inference provider (bond, model, endpoint, jobs ok/fail). Built server-side on a cron, stored in D1, served from cache.",
      network: "stacks-testnet",
      registry: REGISTRY_CONTRACT,
      idScheme:
        "Registry numeric id as a string ('1', '2', …), or the slug 'demand' for the known demand Legion.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseShape: {
        entry:
          "{ id, kind ('demand'|'provider'), owner, treasury, gov, fees, providers, model, uri, active, source }",
        snapshot:
          "Demand: { updatedAt, blockHeight, treasury, totalStaked, members, proposals, errors }. Provider: { updatedAt, blockHeight, treasuryBalance, minStake, totalStaked, providers: [{ address, name, model, endpoint, stake, health, flagged, active }], errors }.",
      },
      related: { index: "/api/legions", skill: "/legion/skill.md" },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse(id);

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/legions/[id]" })
    : createConsoleLogger({ rayId, path: "/api/legions/[id]" });

  const entry = await resolveLegionEntry(env, ctx, id, logger);
  if (!entry) {
    return NextResponse.json(
      { error: "legion_not_found", id },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const snapshot =
    entry.kind === "provider"
      ? await getProviderSnapshot(env, ctx, entry, logger)
      : await getLegionSnapshot(env, ctx, logger, entry.id, entry);

  if (!snapshot) {
    return NextResponse.json(
      { error: "snapshot_unavailable", id },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
    );
  }

  return NextResponse.json(
    { entry, snapshot },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
