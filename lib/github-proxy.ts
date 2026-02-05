import { NextResponse } from "next/server";

export const GITHUB_RAW = "https://raw.githubusercontent.com/aibtcdev/openclaw-aibtc/main";

export async function fetchGitHubScript(scriptPath: string): Promise<NextResponse> {
  try {
    const response = await fetch(GITHUB_RAW + scriptPath);
    if (!response.ok) {
      return new NextResponse("Script not found", { status: 404 });
    }
    const script = await response.text();
    return new NextResponse(script, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Error fetching script", { status: 500 });
  }
}
