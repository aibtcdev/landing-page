import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { updateAgentInD1 } from "@/lib/d1/agents-mirror";
import { stacksApiFetch, buildHiroHeaders } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE, IDENTITY_REGISTRY_CONTRACT } from "@/lib/identity/constants";
import {
  getCachedIdentity,
  setCachedIdentity,
  setCachedIdentityNegative,
  setCachedIdentityLookupFailed,
} from "@/lib/identity/kv-cache";
import {
  createLogger,
  createConsoleLogger,
  isLogsRPC,
} from "@/lib/logging";
import { buildEdgeCacheKey, withEdgeCache } from "@/lib/edge-cache";

const IDENTITY_CACHE_TTL_SECONDS = 3600;
const IDENTITY_CACHE_HEADER = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600";

/**
 * GET /api/identity/:address — Detect on-chain ERC-8004 identity for an agent.
 *
 * Fetches ERC-8004 identity directly from Hiro NFT holdings API.
 * Uses three-state caching: undefined = never checked (hit Hiro),
 * null = checked and not found (return cached), number = confirmed.
 * Persists result to KV on both btc: and stx: keys.
 *
 * Returns: { agentId: number | null }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || address.trim().length === 0) {
    return NextResponse.json(
      {
        endpoint: "/api/identity/[address]",
        description:
          "Detect on-chain ERC-8004 identity for a registered agent. " +
          "Scans the identity registry contract server-side and caches " +
          "the result in KV.",
        parameters: {
          address:
            "BTC (bc1...) or STX (SP...) address of a registered agent",
        },
        response: {
          agentId: "number | null — the on-chain NFT token ID, or null if not registered",
        },
        example: "GET /api/identity/bc1q...",
      },
      { status: 400 }
    );
  }

  // Wrap the resolve + Hiro fan-out in an edge-cache layer.
  // A cache hit skips lookupAgent + the typed-cache reads + the
  // Hiro round-trip entirely. Validation above runs first; only
  // ok responses inside the loader get cached.
  const cacheKey = buildEdgeCacheKey("/api/identity", address);
  return await withEdgeCache(cacheKey, IDENTITY_CACHE_TTL_SECONDS, async () => {
  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const db = env.DB as D1Database | undefined;

    const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
    const baseCtx = { rayId, path: request.nextUrl.pathname };
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, baseCtx)
      : createConsoleLogger(baseCtx);

    const agent = await lookupAgent(kv, address, db);

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", address },
        { status: 404 }
      );
    }

    // Positive result in KV — return immediately
    // Identity NFTs are immutable once minted; cache aggressively at the CDN layer.
    if (agent.erc8004AgentId != null) {
      return NextResponse.json(
        { agentId: agent.erc8004AgentId },
        { headers: { "Cache-Control": IDENTITY_CACHE_HEADER } }
      );
    }

    // Consult the typed identity cache before hitting Hiro. This covers both
    // confirmed-negative (7d TTL) and lookup-failed (60s TTL) hits, so the
    // concurrent-badge-render hammer is suppressed by failures recorded from
    // any entry point (SSR, backfill, refresh endpoint).
    const typedCached = await getCachedIdentity(agent.stxAddress, kv);
    if (typedCached.hit) {
      if (typedCached.value) {
        return NextResponse.json(
          { agentId: typedCached.value.agentId },
          { headers: { "Cache-Control": IDENTITY_CACHE_HEADER } }
        );
      }
      // Both confirmed-negative (7d KV) and lookup-failed (60s KV) hits
      // serialize as `value: null` here. We treat both as edge-cacheable
      // for the full IDENTITY_CACHE_TTL_SECONDS because the refresh endpoint
      // (`/api/identity/[address]/refresh`) is the documented bust path — a
      // user catching a transient Hiro-down period in this cache can refresh
      // to break out. Trade-off accepted per #611.
      return NextResponse.json(
        { agentId: null },
        { headers: { "Cache-Control": IDENTITY_CACHE_HEADER } }
      );
    }

    // Fetch from Hiro
    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-identity`;
    const url = `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${agent.stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    // Browser-facing endpoint — reduced retry budget so sustained Hiro 429s
    // cannot block the identity badge render for tens of seconds.
    const resp = await stacksApiFetch(
      url,
      { headers: buildHiroHeaders(env.HIRO_API_KEY) },
      { retries: 2, retries429: 1, logger }
    );
    if (!resp.ok) {
      // Short-TTL lookup-failed cache so concurrent badge renders don't each
      // re-hit Hiro while the upstream is degraded.
      await setCachedIdentityLookupFailed(agent.stxAddress, kv, logger);
      return NextResponse.json(
        { error: `Hiro API error: ${resp.status}` },
        { status: 502 }
      );
    }

    const data = await resp.json() as {
      results?: Array<{ value: { repr: string } }>;
    };

    const repr = data.results?.[0]?.value?.repr;
    const match = repr?.match(/^u(\d+)$/);
    const agentId = match ? Number(match[1]) : null;

    // Persist to KV if changed, and keep the three-state identity cache in
    // sync so other paths (SSR, backfill, refresh endpoint) don't serve a
    // stale value.
    if (agentId !== agent.erc8004AgentId) {
      agent.erc8004AgentId = agentId;
      const updated = JSON.stringify(agent);
      await Promise.all([
        kv.put(`stx:${agent.stxAddress}`, updated),
        kv.put(`btc:${agent.btcAddress}`, updated),
        updateAgentInD1(db, agent),
      ]);
    }

    if (agentId != null) {
      await setCachedIdentity(
        agent.stxAddress,
        { agentId, owner: agent.stxAddress, uri: "" },
        kv,
        logger
      );
    } else {
      // Confirmed no identity NFT for this address — 7d cache per three-state
      // model.
      await setCachedIdentityNegative(agent.stxAddress, kv, logger);
    }

    return NextResponse.json(
      { agentId },
      { headers: { "Cache-Control": IDENTITY_CACHE_HEADER } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Identity detection failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
  });
}
