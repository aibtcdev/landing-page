import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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
 */
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

    kvStatus = "connected";

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

    // Count registered and claimed agents in parallel
    [registeredCount, claimedCount] = await Promise.all([
      countPrefix(kv, "stx:"),
      countPrefix(kv, "claim:"),
    ]);
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
