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
      { status: 500 }
    );
  }

  // Constant-time comparison to prevent timing side-channel attacks.
  // HMAC-based: compute HMAC of both values with the same key and compare
  // digests. This is timing-safe because the final === compares fixed-length
  // hex strings, and both HMACs always run regardless of input.
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("admin-auth"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [hmacA, hmacB] = await Promise.all([
    crypto.subtle.sign("HMAC", hmacKey, encoder.encode(adminKey)),
    crypto.subtle.sign("HMAC", hmacKey, encoder.encode(expectedKey)),
  ]);
  const hexA = [...new Uint8Array(hmacA)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hexB = [...new Uint8Array(hmacB)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hexA !== hexB) {
    return NextResponse.json(
      { error: "Invalid admin key" },
      { status: 401 }
    );
  }

  return null;
}
