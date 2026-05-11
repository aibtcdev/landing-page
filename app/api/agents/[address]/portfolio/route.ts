// CACHE_INVARIANTS:POSTURE=public-only-get
// Per-agent portfolio (current USD wallet value via Tenero).
// Pure-KV when the cache is warm; falls back to a live Tenero fetch on
// cache miss. Used by /agents AgentList for the Portfolio column.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  getCachedPortfolio,
  refreshAgentPortfolio,
  type AgentPortfolio,
} from "@/lib/competition/portfolio";

/**
 * Accept any of the address shapes /agents/[address] accepts, then
 * resolve to the STX address Tenero indexes by. For now: only STX
 * addresses pass through directly — BTC / taproot / agent-id / BNS
 * resolution can layer on if the column needs to work from those input
 * shapes later. The /agents page already has the stxAddress per row,
 * so this endpoint is called with STX from the start.
 */
function isStxAddress(addr: string): boolean {
  return /^S[PM][0-9A-Z]{38,40}$/.test(addr);
}

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/agents/:address/portfolio",
      method: "GET",
      description:
        "Returns the agent's current USD wallet value, sourced from Tenero's wallets/holdings_value endpoint. Pure-KV when the cache is warm; falls back to a live Tenero fetch on cache miss. The address path param must be an STX address (SP...).",
      responseFormat: {
        portfolio: {
          stx_address: "string (STX address)",
          native_value_usd: "number | null (native STX balance × current STX price)",
          token_value_usd: "number | null (sum of SIP-10 token holdings in USD)",
          total_value_usd: "number | null (native + token)",
          token_count: "number | null (distinct SIP-10 tokens held)",
          fetchedAt: "string (ISO-8601 — when this snapshot of the portfolio was taken)",
        },
        source: "'cache' | 'live' — whether the response came from KV cache or a fresh Tenero fetch",
      },
      notes: [
        "Tenero holdings_value is wallet-wide, not competition-scoped. Includes airdrops, OTC transfers, LP positions — anything that moves the token balance.",
        "Cache TTL is 2 hours. After that, the next request triggers a live refresh.",
        "On Tenero failure during a live fetch, returns the last cached value if present, else null fields.",
      ],
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") return selfDocResponse();

  const { address } = await params;

  if (!isStxAddress(address)) {
    return NextResponse.json(
      {
        error: "invalid_address",
        message: "This endpoint requires an STX address (SP...).",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Try cache first. If warm, return immediately and let a background
  // refresh keep it fresh for the next caller via ctx.waitUntil.
  const cached = await getCachedPortfolio(kv, address, logger);
  if (cached) {
    // Kick off an opportunistic background refresh — non-blocking.
    // Won't run if the request is already being torn down, which is
    // fine; the cache survives for the next request.
    ctx.waitUntil(refreshAgentPortfolio(kv, address, logger).catch(() => undefined));
    return respond(cached, "cache");
  }

  // Cache cold — do a live fetch synchronously so the column populates
  // on first paint. Costs the caller ~one Tenero round-trip on first
  // hit per agent; subsequent renders hit cache.
  const fresh = await refreshAgentPortfolio(kv, address, logger);
  if (fresh) return respond(fresh, "live");

  // Tenero failed AND cache is empty — return null shape so callers
  // can render `—` without special-casing the response.
  return respond(
    {
      stx_address: address,
      native_value_usd: null,
      token_value_usd: null,
      total_value_usd: null,
      token_count: null,
      fetchedAt: new Date().toISOString(),
    },
    "live"
  );
}

function respond(portfolio: AgentPortfolio, source: "cache" | "live"): NextResponse {
  // Short s-maxage so the edge cache doesn't outlive the KV cache TTL.
  // 5 min keeps repeated AgentList loads cheap without hiding fresh
  // background refreshes for long.
  return NextResponse.json(
    { portfolio, source },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
