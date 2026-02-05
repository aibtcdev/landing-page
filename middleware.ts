import { NextRequest, NextResponse } from "next/server";
import { GITHUB_RAW } from "@/lib/github-proxy";

function isCLI(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return ua.includes("curl") || ua.includes("wget") || ua.includes("httpie");
}

function getDeprecationBanner(newPath: string): string {
  return `# ┌──────────────────────────────────────────────────────────────────┐
# │  NOTICE: This URL is deprecated.                                │
# │  New URL: curl https://aibtc.com${newPath} | sh          │
# │  This path will continue to work but may be removed in future.  │
# └──────────────────────────────────────────────────────────────────┘
#
`;
}

export async function middleware(request: NextRequest) {
  // Only intercept CLI tools
  if (!isCLI(request)) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;

  // Root path: rewrite to serve public/llms.txt
  if (path === "/") {
    return NextResponse.rewrite(new URL("/llms.txt", request.url));
  }

  if (path === "/skills") {
    return NextResponse.next();
  }

  // Map deprecated paths to scripts and new install URLs
  let scriptPath: string;
  let newPath: string;
  switch (path) {
    case "/vps":
      scriptPath = "/vps-setup.sh";
      newPath = "/install/openclaw";
      break;
    case "/local":
      scriptPath = "/local-setup.sh";
      newPath = "/install/openclaw/local";
      break;
    case "/update":
    case "/update-skill.sh":
      scriptPath = "/update-skill.sh";
      newPath = "/install/openclaw/update";
      break;
    default:
      return NextResponse.next();
  }

  try {
    const response = await fetch(GITHUB_RAW + scriptPath);

    if (!response.ok) {
      return new NextResponse("Script not found", { status: 404 });
    }

    const script = await response.text();
    const banner = getDeprecationBanner(newPath);
    const scriptWithBanner = banner + script;

    return new NextResponse(scriptWithBanner, {
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
  matcher: ["/", "/vps", "/local", "/update", "/update-skill.sh", "/skills"],
};
