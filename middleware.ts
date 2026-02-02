import { NextRequest, NextResponse } from "next/server";

const GITHUB_RAW =
  "https://raw.githubusercontent.com/aibtcdev/openclaw-aibtc/main";

function isCLI(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return ua.includes("curl") || ua.includes("wget") || ua.includes("httpie");
}

export async function middleware(request: NextRequest) {
  // Only intercept CLI tools
  if (!isCLI(request)) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;

  // Map paths to scripts
  let scriptPath: string;
  switch (path) {
    case "/":
    case "/vps":
      scriptPath = "/vps-setup.sh";
      break;
    case "/local":
      scriptPath = "/local-setup.sh";
      break;
    case "/update":
      scriptPath = "/update-skill.sh";
      break;
    default:
      // Pass through other paths (could be /update-skill.sh, etc.)
      scriptPath = path;
  }

  try {
    const response = await fetch(GITHUB_RAW + scriptPath);

    if (!response.ok) {
      return new NextResponse("Script not found", { status: 404 });
    }

    const script = await response.text();

    return new NextResponse(script, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new NextResponse("Error fetching script", { status: 500 });
  }
}

export const config = {
  matcher: ["/", "/vps", "/local", "/update", "/update-skill.sh", "/skills/:path*"],
};
