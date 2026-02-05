import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const llmsUrl = new URL("/llms.txt", request.url);
  // 301 permanent redirect - /skills is a legacy alias for /llms.txt
  return NextResponse.redirect(llmsUrl, 301);
}
