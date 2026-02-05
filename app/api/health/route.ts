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
  let agentCount: number | undefined;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Verify KV is accessible with a lightweight list operation
    const listResult = await kv.list({ prefix: "stx:", limit: 1 });

    kvStatus = "connected";

    // Count total agents (lightweight — just counts keys, doesn't fetch values)
    // For small registries this is fine; for large ones we'd use a counter key
    let count = listResult.keys.length;
    let cursor: string | undefined = !listResult.list_complete
      ? listResult.cursor
      : undefined;
    let listComplete = listResult.list_complete;

    while (!listComplete) {
      const page = await kv.list({ prefix: "stx:", cursor });
      count += page.keys.length;
      listComplete = page.list_complete;
      cursor = !page.list_complete ? page.cursor : undefined;
    }

    agentCount = count;
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
        ...(agentCount !== undefined && { agentCount }),
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
