import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildActivityData } from "@/lib/activity";
import type { ActivityResponse } from "@/app/components/activity-shared";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CACHE_KEY_URL = "https://cache.aibtc.local/api/activity";
const RESPONSE_MAX_AGE = 60;
const RESPONSE_S_MAXAGE = 120;

// Module-level in-flight map collapses concurrent rebuilds inside one
// isolate to a single buildActivityData() call. Combined with
// caches.default (coherent across isolates inside a colo) this gives an
// effective single-flight without the KV-RMW mutex that previously lived
// at `cache:activity:building`.
const inFlight = new Map<string, Promise<Response>>();

function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

async function buildAndCache(
  kv: KVNamespace,
  db: D1Database | undefined,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
): Promise<Response> {
  const data: ActivityResponse = await buildActivityData(kv, db);
  const response = NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, max-age=${RESPONSE_MAX_AGE}, s-maxage=${RESPONSE_S_MAXAGE}`,
      "X-Cache": "MISS",
      ...CORS_HEADERS,
    },
  });

  const cache = getDefaultCache();
  if (cache) {
    const cacheKey = new Request(CACHE_KEY_URL, { method: "GET" });
    const cachedClone = new Response(response.clone().body, response);
    const stash = cache.put(cacheKey, cachedClone);
    if (ctx) {
      ctx.waitUntil(stash);
    } else {
      await stash;
    }
  }

  return response;
}

/**
 * GET /api/activity
 *
 * Returns recent network activity (messages, registrations)
 * and aggregate statistics (total agents, active agents, messages, sats).
 *
 * Cached in `caches.default` for 120s via s-maxage. Concurrent rebuild
 * requests inside one isolate are deduplicated through `inFlight`;
 * cross-isolate coherence comes from `caches.default` itself.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/activity",
      method: "GET",
      description: "Get recent network activity across all agents. Returns events (messages, registrations) and aggregate statistics. Cached for 2 minutes.",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
      },
      responseFormat: {
        events: [
          {
            type: "message | registration",
            timestamp: "string (ISO 8601 timestamp)",
            agent: {
              btcAddress: "string",
              displayName: "string",
            },
            recipient: {
              btcAddress: "string",
              displayName: "string",
            },
          },
        ],
        stats: {
          totalAgents: "number",
          activeAgents: "number (agents active in last 7 days)",
          totalMessages: "number",
          totalSatsTransacted: "number",
        },
      },
      cachingStrategy: {
        description: "Response is cached in caches.default (the Cloudflare edge cache) for 2 minutes via s-maxage. Stats derived from shared agent-list cache (no independent O(N) scan). Only event detail fetches for top 20 active agents remain as targeted KV reads.",
        sMaxAgeSeconds: RESPONSE_S_MAXAGE,
        cacheKeyUrl: CACHE_KEY_URL,
      },
      relatedEndpoints: {
        agents: "/api/agents - List all agents with pagination",
        inbox: "/api/inbox/:address - View agent inbox",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120",
        ...CORS_HEADERS,
      },
    });
  }

  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const db = env.DB as D1Database | undefined;

    const cache = getDefaultCache();
    if (cache) {
      const cached = await cache.match(new Request(CACHE_KEY_URL, { method: "GET" }));
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("X-Cache", "HIT");
        return new Response(cached.body, { status: cached.status, headers });
      }
    }

    let promise = inFlight.get(CACHE_KEY_URL);
    if (!promise) {
      promise = buildAndCache(kv, db, ctx).finally(() => {
        inFlight.delete(CACHE_KEY_URL);
      });
      inFlight.set(CACHE_KEY_URL, promise);
    }

    const result = await promise;
    // Concurrent awaiters can't share a single Response body stream;
    // clone for this request so each caller has its own readable copy.
    return new Response(result.clone().body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    console.error("Failed to fetch activity:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch network activity",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
