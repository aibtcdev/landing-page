import { NextResponse } from "next/server";

/**
 * Backward-compatible alias for bounty board links that still use `/bounties`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/bounty";
  return NextResponse.redirect(url, 308);
}

