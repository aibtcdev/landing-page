/**
 * GET /api/prices — cached USD prices for supported Stacks tokens.
 *
 * Data comes from KV (`tenero:price:{tokenId}`), which the `SchedulerDO`
 * refreshes every ~5 min by calling Tenero. This route is a pure read
 * surface — it never calls Tenero itself, so its cost scales with KV
 * reads, not upstream API quota.
 *
 * Shapes:
 * - `GET /api/prices` with `Accept: application/json` → all cached prices
 * - `GET /api/prices?token={tokenId}` with `Accept: application/json` → single token
 * - `GET /api/prices` without `application/json` in `Accept` → self-doc
 *
 * Rate-limited via the existing `RATE_LIMIT_READ` binding (300 req / 60 s
 * per IP). Fails open on binding errors in local dev, closed otherwise —
 * matches the project convention (#666).
 *
 * Adding a new priceable token: edit `STATIC_TOKEN_IDS` in
 * `lib/external/tenero/tokens.ts` AND `TOKEN_DECIMALS` in
 * `app/leaderboard/page.tsx`. Run a Tenero probe first to confirm the
 * contract id has a non-null `price_usd`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  getCachedTokenPrice,
  getCachedTokenPrices,
} from "@/lib/external/tenero/kv-cache";
import { STATIC_TOKEN_IDS } from "@/lib/external/tenero/tokens";
import { createConsoleLogger, createLogger, isLogsRPC } from "@/lib/logging";

const RATE_LIMIT_RETRY_AFTER = 60;

/**
 * In production / preview, fail closed when the rate-limit binding errors
 * (matches #666 convention via `DEPLOY_ENV !== undefined`).
 */
function shouldFailClosed(env: CloudflareEnv): boolean {
  return env.DEPLOY_ENV !== undefined;
}

function acceptsJson(request: NextRequest): boolean {
  const accept = request.headers.get("Accept") ?? "";
  return accept.toLowerCase().includes("application/json");
}

function selfDoc(): NextResponse {
  return NextResponse.json(
    {
      endpoint: "/api/prices",
      description:
        "USD prices for supported Stacks tokens. Cached by the SchedulerDO " +
        "(~5 min refresh cadence) from Tenero. Read-only — no upstream calls.",
      methods: {
        "GET /api/prices": {
          accept: "application/json",
          description: "Return cached USD prices for all supported tokens.",
          response: {
            prices: {
              "{tokenId}": {
                priceUsd:
                  "number | null — USD price; null when Tenero confirmed no published price",
                fetchedAt: "number — unix millis when the cache entry was written",
              },
            },
            supportedTokens:
              "string[] — full list of tokenIds the scheduler refreshes",
          },
        },
        "GET /api/prices?token={tokenId}": {
          accept: "application/json",
          description: "Return a single token's cached price.",
          response: {
            tokenId: "string",
            priceUsd: "number | null",
            fetchedAt: "number | null — null when no cache entry exists yet",
          },
        },
      },
      supportedTokens: STATIC_TOKEN_IDS,
      addingATokenRequires: [
        "Adding to STATIC_TOKEN_IDS in lib/external/tenero/tokens.ts",
        "Adding to TOKEN_DECIMALS in app/leaderboard/page.tsx",
        "Probing https://api.tenero.io/v1/stacks/tokens/{contract_id} for a non-null price_usd",
      ],
      rateLimit: "300 req / 60 s per IP (RATE_LIMIT_READ binding)",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const rayId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/prices" })
    : createConsoleLogger({ rayId, path: "/api/prices" });

  if (!acceptsJson(request)) {
    return selfDoc();
  }

  // Rate-limit by IP. RATE_LIMIT_READ is a 300/60s bucket; KV reads are
  // cheap so this is the right size. Fails closed in deployed envs.
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  let limited = false;
  try {
    const result = await env.RATE_LIMIT_READ.limit({ key: `prices:${ip}` });
    limited = !result.success;
  } catch (err) {
    const failClosed = shouldFailClosed(env);
    logger.warn("prices.rate_limit_binding_error", {
      error: String(err),
      failClosed,
    });
    if (failClosed) limited = true;
  }
  if (limited) {
    return NextResponse.json(
      {
        error: "Too many requests. Slow down.",
        retryAfter: RATE_LIMIT_RETRY_AFTER,
      },
      {
        status: 429,
        headers: { "Retry-After": String(RATE_LIMIT_RETRY_AFTER) },
      }
    );
  }

  const kv = env.VERIFIED_AGENTS;
  if (!kv) {
    return NextResponse.json(
      { error: "Price cache unavailable in this environment." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  // Single-token lookup
  if (token) {
    const cached = await getCachedTokenPrice(kv, token);
    return NextResponse.json(
      {
        tokenId: token,
        priceUsd: cached?.priceUsd ?? null,
        fetchedAt: cached?.fetchedAt ?? null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60",
        },
      }
    );
  }

  // Full set
  const cached = await getCachedTokenPrices(kv, STATIC_TOKEN_IDS);
  const prices: Record<string, { priceUsd: number | null; fetchedAt: number }> =
    {};
  for (const [tokenId, entry] of cached) {
    prices[tokenId] = {
      priceUsd: entry.priceUsd,
      fetchedAt: entry.fetchedAt,
    };
  }
  return NextResponse.json(
    {
      prices,
      supportedTokens: STATIC_TOKEN_IDS,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=60",
      },
    }
  );
}
