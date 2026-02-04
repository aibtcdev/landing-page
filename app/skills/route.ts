import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const llmsUrl = new URL("/llms.txt", request.url);
  return NextResponse.redirect(llmsUrl, 302);
}
