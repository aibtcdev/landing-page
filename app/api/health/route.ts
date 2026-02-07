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

    // Count registered agents (stx: prefix)
    let regCount = 0;
    let regCursor: string | undefined;
    let regComplete = false;

    while (!regComplete) {
      const page = await kv.list({ prefix: "stx:", cursor: regCursor });
      regCount += page.keys.length;
      regComplete = page.list_complete;
      regCursor = !page.list_complete ? page.cursor : undefined;
    }
    registeredCount = regCount;

    // Count claimed agents (claim: prefix)
    let claimCount = 0;
    let claimCursor: string | undefined;
    let claimComplete = false;

    while (!claimComplete) {
      const page = await kv.list({ prefix: "claim:", cursor: claimCursor });
      claimCount += page.keys.length;
      claimComplete = page.list_complete;
      claimCursor = !page.list_complete ? page.cursor : undefined;
    }
    claimedCount = claimCount;
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
