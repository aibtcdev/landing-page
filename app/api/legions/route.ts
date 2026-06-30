// CACHE_INVARIANTS:POSTURE=public-only-get
// Read-only Legion registry index (Stacks testnet). No auth, no per-caller
// branching. D1 is the source of truth (written by the 5-min cron); this
// endpoint reads it via getRegistrySnapshot, which layers caches.default +
// singleflight on top (mirrors /api/legion). Hiro is only hit on a stale/cold
// rebuild, never per request.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { getRegistrySnapshot } from "@/lib/legion/read";
import { REGISTRY_CONTRACT } from "@/lib/legion/constants";

export const dynamic = "force-dynamic";

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/legions",
      method: "GET",
      description:
        "Read-only index of every AIBTC Legion (Stacks testnet): demand Legions (pool + govern an sBTC treasury) and provider Legions (operators join the gateway for free, serve a model, earn sBTC per call; an optional legion-engage stake buys ranking). Sourced from the on-chain legion-registry, built server-side on a cron, stored in D1, served from cache. Fetch /api/legions/{id} for one Legion's full detail.",
      network: "stacks-testnet",
      registry: REGISTRY_CONTRACT,
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseShape: {
        updatedAt: "number (unix ms)",
        legions:
          "Array<{ id, kind ('demand'|'provider'), owner, model, uri, active, treasuryBalance (sats|null), count (#proposals or #providers|null), source ('registry'|'fallback') }>",
        errors: "string[] (per-read failures; partial lists are still served)",
      },
      related: {
        detail: "/api/legions/{id}",
        skill: "/legion/skill.md",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/legions" })
    : createConsoleLogger({ rayId, path: "/api/legions" });

  const registry = await getRegistrySnapshot(env, ctx, logger);

  if (!registry) {
    return NextResponse.json(
      { error: "registry_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
    );
  }

  return NextResponse.json(registry, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
