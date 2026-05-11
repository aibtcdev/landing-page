// CACHE_INVARIANTS:POSTURE=public-only-get
// See lib/inbox/CACHE_INVARIANTS.md — GET handler is fully public.
// Read-only status surface; no auth, no per-caller branching.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { isStxAddress } from "@/lib/validation/address";
import { shouldFailClosed } from "@/lib/env";
import { getCompetitionStatusFromD1 } from "@/lib/competition/d1-reads";

/** Retry-After value (seconds) to return on 429s — matches the 60s binding window. */
const RATE_LIMIT_RETRY_AFTER = 60;

function selfDocResponse() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/status",
      method: "GET",
      description:
        "Trading-comp status for a single STX address. Returns membership + verified trade counts. Unregistered addresses return { registered: false } (not 404) so callers can route to identity_register.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
        address: {
          type: "string",
          required: true,
          description: "Stacks mainnet address (SP… / SM…) to look up",
          example: "?address=SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
        },
      },
      responseFormat: {
        address: "string (STX address)",
        agent_id: "number | null (ERC-8004 identity NFT id; null until the agent registers their identity NFT)",
        registered: "boolean (is the address a registered AIBTC agent)",
        trade_count: "number (total swaps recorded for this sender)",
        verified_trade_count: "number (swaps with tx_status='success')",
        first_trade_at: "number | null (unix seconds of earliest swap)",
        last_trade_at: "number | null (unix seconds of latest swap)",
      },
      relatedEndpoints: {
        trades: "GET /api/competition/trades?address={stx} — paginated trade history",
        submit: "POST /api/competition/trades — verify a swap by txid (ships in Phase 3.1 PR-B)",
        identity: "GET /api/agents/{address} — agent profile",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return selfDocResponse();
  }

  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const address = searchParams.get("address");
  if (!address || !isStxAddress(address)) {
    return NextResponse.json(
      {
        error: "Missing or invalid `address` query param. Expected a Stacks mainnet address (SP… / SM…).",
        example: "/api/competition/status?address=SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
      },
      { status: 400 }
    );
  }

  // IP-keyed read rate limit (300/min — see wrangler.jsonc RATE_LIMIT_READ).
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  let ipLimited = false;
  try {
    const result = await env.RATE_LIMIT_READ.limit({ key: `comp-status:${ip}` });
    ipLimited = !result.success;
  } catch (err) {
    const failClosed = shouldFailClosed(env);
    logger.warn("Rate limit binding error", { error: String(err), failClosed });
    if (failClosed) ipLimited = true;
  }
  if (ipLimited) {
    return NextResponse.json(
      { error: "Too many requests from this IP. Slow down.", retryAfter: RATE_LIMIT_RETRY_AFTER },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/status");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  try {
    const status = await getCompetitionStatusFromD1(db, address);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "public, max-age=10, s-maxage=10" },
    });
  } catch (err) {
    logger.warn("D1 read failed on competition/status", { error: String(err), address });
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
}
