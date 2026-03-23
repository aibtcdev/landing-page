import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildActivityData } from "@/lib/activity";
import type { ActivityResponse } from "@/app/components/activity-shared";

/**
 * Cached activity data stored at `cache:activity` in KV.
 */
interface CachedActivity {
  data: ActivityResponse;
  cachedAt: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CACHE_KEY = "cache:activity";
const BUILDING_KEY = "cache:activity:building";
const CACHE_TTL_SECONDS = 120; // 2 minutes
const BUILDING_TTL_SECONDS = 30;

/**
 * GET /api/activity
 *
 * Returns recent network activity (messages, achievements, registrations)
 * and aggregate statistics (total agents, active agents, messages, sats).
 *
 * Caches result in KV for 2 minutes. Uses the shared agent-list cache
 * to derive stats and identify top active agents — no independent O(N) scan.
 */
export async function GET(request: NextRequest) {
  // Self-documenting: return usage docs when explicitly requested via ?docs=1
  const { searchParams } = new URL(request.url);
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/activity",
      method: "GET",
      description: "Get recent network activity across all agents. Returns events (messages, achievements, registrations) and aggregate statistics. Cached for 2 minutes.",
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
            type: "message | achievement | registration",
            timestamp: "string (ISO 8601 timestamp)",
            agent: {
              btcAddress: "string",
              displayName: "string",
            },
            recipient: {
              btcAddress: "string",
              displayName: "string",
            },
            achievementId: "string (for achievement events)",
            achievementName: "string (for achievement events)",
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
        description: "Response is cached in KV for 2 minutes. Stats derived from shared agent-list cache (no independent O(N) scan). Only event detail fetches for top 20 active agents remain as targeted KV reads.",
        ttl: CACHE_TTL_SECONDS,
        key: CACHE_KEY,
      },
      relatedEndpoints: {
        agents: "/api/agents - List all agents with pagination",
        inbox: "/api/inbox/:address - View agent inbox",
        achievements: "/api/achievements - Achievement definitions and lookups",
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
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check cache first
    const cached = await kv.get<CachedActivity>(CACHE_KEY, "json");
    if (cached && cached.data) {
      const cachedAge = Date.now() - new Date(cached.cachedAt).getTime();
      if (cachedAge < CACHE_TTL_SECONDS * 1000) {
        return NextResponse.json(cached.data, {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=120",
            "X-Cache": "HIT",
            "X-Cache-Age": Math.floor(cachedAge / 1000).toString(),
            ...CORS_HEADERS,
          },
        });
      }
    }

    // Cache miss — check if another request is already rebuilding (thundering herd guard)
    const building = await kv.get(BUILDING_KEY);
    if (building) {
      // Return stale data if available, otherwise a minimal fallback
      if (cached && cached.data) {
        return NextResponse.json(cached.data, {
          headers: {
            "Cache-Control": "public, max-age=30, s-maxage=60",
            "X-Cache": "STALE",
            ...CORS_HEADERS,
          },
        });
      }
      return NextResponse.json(
        { events: [], stats: { totalAgents: 0, activeAgents: 0, totalMessages: 0, totalSatsTransacted: 0 } },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Cache": "MISS-BUILDING",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Claim rebuild with sentinel (best-effort)
    try {
      await kv.put(BUILDING_KEY, "1", { expirationTtl: BUILDING_TTL_SECONDS });
    } catch {
      // Proceed anyway — worst case is a duplicate rebuild
    }

    let response: ActivityResponse;
    try {
      response = await buildActivityData(kv);

      // Cache the response
      const cacheData: CachedActivity = {
        data: response,
        cachedAt: new Date().toISOString(),
      };
      await kv.put(CACHE_KEY, JSON.stringify(cacheData), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    } catch (buildError) {
      // Clear sentinel and re-throw so the outer catch returns a structured error
      await kv.delete(BUILDING_KEY).catch(() => {});
      throw buildError;
    }

    // Clear sentinel after successful rebuild
    await kv.delete(BUILDING_KEY).catch(() => {});

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120",
        "X-Cache": "MISS",
        ...CORS_HEADERS,
      },
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
