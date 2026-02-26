import { NextRequest, NextResponse } from "next/server";
import { GITHUB_RAW } from "@/lib/github-proxy";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { X_HANDLE } from "@/lib/constants";

const CRAWLER_UA_PATTERNS = [
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
];

function isCrawler(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return CRAWLER_UA_PATTERNS.some((pattern) => ua.includes(pattern));
}

function isCLI(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return ua.includes("curl") || ua.includes("wget") || ua.includes("httpie");
}

function getDeprecationBanner(newPath: string): string {
  const lines = [
    "NOTICE: This URL is deprecated.",
    `New URL: curl https://aibtc.com${newPath} | sh`,
    "This path will continue to work but may be removed in future.",
  ];

  const innerWidth = Math.max(...lines.map((line) => line.length));
  const topBorder = `# ┌${"─".repeat(innerWidth + 2)}┐`;
  const bottomBorder = `# └${"─".repeat(innerWidth + 2)}┘`;

  const content = lines
    .map((line) => `# │ ${line.padEnd(innerWidth)} │`)
    .join("\n");

  return `${topBorder}
${content}
${bottomBorder}
#
`;
}

async function handleCrawlerAgentPage(
  request: NextRequest,
  path: string
): Promise<NextResponse> {
  const address = path.replace("/agents/", "").split("/")[0];
  if (!address) {
    return NextResponse.next();
  }

  const prefix = address.startsWith("SP")
    ? "stx"
    : address.startsWith("bc1")
      ? "btc"
      : null;
  if (!prefix) {
    return NextResponse.next();
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const agentData = await kv.get(`${prefix}:${address}`);
    if (!agentData) {
      return NextResponse.next();
    }

    const agent = JSON.parse(agentData) as AgentRecord;
    const displayName = agent.displayName || generateName(agent.btcAddress);
    const description =
      agent.description ||
      "Verified AIBTC agent with Bitcoin and Stacks capabilities";

    const claimData = await kv.get(`claim:${agent.btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        /* ignore */
      }
    }

    const level = computeLevel(agent, claim);
    const levelName = LEVELS[level].name;
    const ogTitle = `${displayName} — ${levelName} Agent`;
    const ogImage = `https://aibtc.com/api/og/${agent.btcAddress}`;
    const canonicalUrl = `https://aibtc.com/agents/${address}`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(ogTitle)} | AIBTC</title>
<meta property="og:title" content="${escapeAttr(ogTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:type" content="profile">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="AIBTC">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${X_HANDLE}">
<meta name="twitter:title" content="${escapeAttr(ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="canonical" href="${canonicalUrl}">
</head>
<body></body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch {
    return NextResponse.next();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Crawlers on agent profile pages: return minimal HTML with OG tags in <head>
  if (isCrawler(request) && path.startsWith("/agents/")) {
    return handleCrawlerAgentPage(request, path);
  }

  // Redirect deprecated /guide/mcp to /guide
  if (path === "/guide/mcp") {
    return NextResponse.redirect(new URL("/guide", request.url), 301);
  }

  // Only intercept CLI tools for remaining middleware logic
  if (!isCLI(request)) {
    return NextResponse.next();
  }

  // Root path: rewrite to serve public/llms.txt
  if (path === "/") {
    return NextResponse.rewrite(new URL("/llms.txt", request.url));
  }

  // Install: rewrite to loop installer script for curl/wget
  if (path === "/install") {
    return NextResponse.rewrite(new URL("/install/loop", request.url));
  }

  // Heartbeat: rewrite to CLI route for curl/wget
  if (path === "/heartbeat") {
    return NextResponse.rewrite(new URL("/heartbeat/cli", request.url));
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
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Error fetching script", { status: 500 });
  }
}

export const config = {
  matcher: [
    "/",
    "/install",
    "/agents/:path*",
    "/guide/mcp",
    "/vps",
    "/local",
    "/update",
    "/update-skill.sh",
    "/skills",
    "/heartbeat",
  ],
};
