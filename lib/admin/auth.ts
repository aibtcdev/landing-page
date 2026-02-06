import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Authenticate an admin request via X-Admin-Key header.
 *
 * Returns null on success, or a 401 NextResponse on failure.
 * This lets callers short-circuit with a single guard:
 *
 *   const denied = await requireAdmin(request);
 *   if (denied) return denied;
 */
export async function requireAdmin(
  request: NextRequest
): Promise<NextResponse | null> {
  const adminKey = request.headers.get("X-Admin-Key");
  if (!adminKey) {
    return NextResponse.json(
      { error: "Missing X-Admin-Key header" },
      { status: 401 }
    );
  }

  const { env } = await getCloudflareContext();
  const expectedKey = env.ARC_ADMIN_API_KEY;

  if (!expectedKey) {
    console.error("ARC_ADMIN_API_KEY is not configured");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 401 }
    );
  }

  if (adminKey !== expectedKey) {
    return NextResponse.json(
      { error: "Invalid admin key" },
      { status: 401 }
    );
  }

  return null;
}
