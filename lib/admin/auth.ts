import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Admin Authentication Result
 */
export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

/**
 * Authenticate admin request via X-Admin-Key header
 *
 * Checks the X-Admin-Key header against the ARC_ADMIN_API_KEY environment
 * variable. Used to protect admin endpoints from unauthorized access.
 *
 * @param request - Next.js request object
 * @returns AuthResult with authentication status and error message if failed
 */
export async function authenticateAdmin(
  request: NextRequest
): Promise<AuthResult> {
  const adminKey = request.headers.get("X-Admin-Key");

  if (!adminKey) {
    return { authenticated: false, error: "Missing X-Admin-Key header" };
  }

  const { env } = await getCloudflareContext();
  const expectedKey = env.ARC_ADMIN_API_KEY;

  if (!expectedKey) {
    return {
      authenticated: false,
      error: "Server configuration error: ARC_ADMIN_API_KEY not set",
    };
  }

  if (adminKey !== expectedKey) {
    return { authenticated: false, error: "Invalid admin key" };
  }

  return { authenticated: true };
}
