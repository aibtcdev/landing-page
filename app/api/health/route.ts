import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withEdgeCache } from "@/lib/edge-cache";

/**
 * GET /api/health — System health check endpoint.
 *
 * Returns the current health status of the AIBTC platform, including:
 * - Overall status ("healthy" or "degraded")
 * - Timestamp of the check
 * - API version
 * - KV store connectivity status
 *
 * Used by agents and monitoring systems to verify the platform is operational
 * before attempting registration or verification calls.
 *
 * Cost note: agent counts come from full `kv.list()` prefix scans, and list
 * operations are the smallest KV quota on the paid plan (1M/mo, $5/M after).
 * This endpoint is polled by monitors and unauthenticated agents, so the
 * counts are served from `caches.default` (5-min TTL) and only the scan
 * refresh pays for list operations. Connectivity is probed with a single
 * keys-read (10M/mo quota) instead.
 */

const COUNTS_CACHE_KEY =
  "https://cache.aibtc.local/internal/health-agent-counts";
const COUNTS_CACHE_TTL_SECONDS = 300;

interface AgentCounts {
  registered: number;
  claimed: number;
}

async function countPrefix(ns: KVNamespace, prefix: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  let complete = false;
  while (!complete) {
    const page = await ns.list({ prefix, cursor });
    count += page.keys.length;
    complete = page.list_complete;
    cursor = !page.list_complete ? page.cursor : undefined;
  }
  return count;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const version = "1.0.0";

  let kvStatus: "connected" | "error" = "error";
  let kvError: string | undefined;
  let registeredCount: number | undefined;
  let claimedCount: number | undefined;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Connectivity probe: a single read (null result still proves KV
    // answered) — never a list scan.
    await kv.get("health:probe");
    kvStatus = "connected";

    const countsResponse = await withEdgeCache(
      COUNTS_CACHE_KEY,
      COUNTS_CACHE_TTL_SECONDS,
      async () => {
        const [registered, claimed] = await Promise.all([
          countPrefix(kv, "stx:"),
          countPrefix(kv, "claim:"),
        ]);
        return NextResponse.json(
          { registered, claimed } satisfies AgentCounts,
          {
            headers: {
              "Cache-Control": `public, s-maxage=${COUNTS_CACHE_TTL_SECONDS}`,
            },
          },
        );
      },
    );
    const counts = (await countsResponse.json()) as AgentCounts;
    registeredCount = counts.registered;
    claimedCount = counts.claimed;
  } catch (e) {
    kvError = (e as Error).message;
  }

  const status = kvStatus === "connected" ? "healthy" : "degraded";

  const body: Record<string, unknown> = {
    status,
    timestamp,
    version,
    services: {
      kv: {
        status: kvStatus,
        ...(kvError && { error: kvError }),
        ...(registeredCount !== undefined && { registeredCount }),
        ...(claimedCount !== undefined && { claimedCount }),
        // Backwards compatibility
        ...(registeredCount !== undefined && { agentCount: registeredCount }),
      },
    },
  };

  const httpStatus = status === "healthy" ? 200 : 503;

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
