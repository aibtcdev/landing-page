import { NextRequest, NextResponse } from "next/server";
import { GITHUB_RAW } from "@/lib/github-proxy";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, formatLevelTitleSuffix } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { X_HANDLE } from "@/lib/constants";
import { buildMiddlewareOgCacheKey } from "@/lib/edge-cache";
import {
  classifyAddress,
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
  mapRowToAgentRecord,
  mapRowToClaimRecord,
  claimRecordToStatus,
} from "@/lib/cache/agent-profile";

const CRAWLER_UA_PATTERNS = [
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "signal",
];

function isCrawler(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return CRAWLER_UA_PATTERNS.some((pattern) => ua.includes(pattern));
}

function isCLI(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent")?.toLowerCase() || "";
  return (
    ua.includes("curl") ||
    ua.includes("wget") ||
    ua.includes("httpie") ||
    ua.includes("python-requests") ||
    ua.includes("node-fetch") ||
    ua.startsWith("http/")
  );
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

  // Middleware handles btc/stx/taproot prefixes — numeric (erc8004 ID) is out of
  // scope (no realistic crawler probes for /agents/<numeric>). Taproot reverse-
  // lookup goes through KV `taproot:` then D1. Pre-flip behavior treated bc1p
  // as a btc lookup; post-flip we honor the taproot indirection so agents whose
  // canonical btc differs from their bc1p taproot still render OG.
  const branch = classifyAddress(address);
  if (branch !== "btc" && branch !== "stx" && branch !== "taproot") {
    return NextResponse.next();
  }

  // Edge-cache check: amortize D1 read + HTML build across crawler hits.
  // Cache API is a Cloudflare Workers extension — absent in Node / next dev.
  // Key on address (lowercased) so repeated crawler probes for the same
  // agent collapse to one slot. On hit, return immediately. On miss or
  // cache error, fall through to the live render path.
  const edgeCacheKey = buildMiddlewareOgCacheKey(address);
  const cacheStore = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
  if (cacheStore) {
    try {
      const cached = await cacheStore.match(new Request(edgeCacheKey));
      if (cached) {
        return new NextResponse(cached.body, cached);
      }
    } catch {
      // Cache read failed — fall through to live render (cache is an optimization only).
    }
  }

  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const db = env.DB as D1Database;

    // Phase 2.3: D1-first lookup — single SELECT + LEFT JOIN claims.
    // For validation-excluded agents (~708 records, #691) that are not yet in D1,
    // fall back to the KV btc:/stx: key to avoid 404ing crawler bots (which would
    // cause search engines to deindex those agent pages).
    let agent: AgentRecord | null = null;
    let claim: ClaimStatus | null = null;
    let kvFallbackKey: string | null = null;

    if (branch === "btc") {
      const row = await lookupProfileByBtcAddress(db, address);
      if (row) {
        agent = mapRowToAgentRecord(row);
        const claimRecord = mapRowToClaimRecord(row);
        if (claimRecord) claim = claimRecordToStatus(claimRecord);
      } else {
        kvFallbackKey = `btc:${address}`;
      }
    } else if (branch === "taproot") {
      // Taproot bc1p* — reverse-lookup canonical btc via KV `taproot:{addr}`
      // (the taproot KV index isn't being migrated in Phase 2.3 per RFC), then D1.
      const canonicalBtc = await kv.get(`taproot:${address}`);
      if (canonicalBtc) {
        const row = await lookupProfileByBtcAddress(db, canonicalBtc);
        if (row) {
          agent = mapRowToAgentRecord(row);
          const claimRecord = mapRowToClaimRecord(row);
          if (claimRecord) claim = claimRecordToStatus(claimRecord);
        } else {
          kvFallbackKey = `btc:${canonicalBtc}`;
        }
      }
    } else {
      // branch === "stx"
      const row = await lookupProfileByStxAddress(db, address);
      if (row) {
        agent = mapRowToAgentRecord(row);
        const claimRecord = mapRowToClaimRecord(row);
        if (claimRecord) claim = claimRecordToStatus(claimRecord);
      } else {
        kvFallbackKey = `stx:${address}`;
      }
    }

    // KV fallback for validation-excluded agents (transitional per #691).
    // Crawlers MUST NOT 404 these — it would deindex them from search engines.
    // Validation-excluded agents likely don't have D1 claims, so we mirror
    // pre-flip behavior: one KV read for agent, one for claim.
    if (!agent && kvFallbackKey) {
      const kvValue = await kv.get(kvFallbackKey);
      if (kvValue) {
        try {
          agent = JSON.parse(kvValue) as AgentRecord;
          // Also attempt claim KV read on fallback path (mirrors pre-flip behavior).
          const claimData = await kv.get(`claim:${agent.btcAddress}`);
          if (claimData) {
            try {
              claim = JSON.parse(claimData) as ClaimStatus;
            } catch {
              /* malformed claim — leave null */
            }
          }
        } catch {
          // Malformed KV record — leave agent null, fall through to next()
        }
      }
    }

    if (!agent) {
      return NextResponse.next();
    }

    const displayName = agent.displayName || generateName(agent.btcAddress);
    const description =
      agent.description ||
      "Verified AIBTC agent with Bitcoin and Stacks capabilities";

    const level = computeLevel(agent, claim);
    const ogTitle = `${displayName} — ${formatLevelTitleSuffix(level)}`;
    const ogImage = `https://aibtc.com/api/og/${encodeURIComponent(agent.btcAddress)}`;
    const canonicalUrl = `https://aibtc.com/agents/${encodeURIComponent(address)}`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(ogTitle)} | AIBTC</title>
<meta property="og:title" content="${escapeAttr(ogTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:type" content="profile">
<meta property="og:url" content="${escapeAttr(canonicalUrl)}">
<meta property="og:image" content="${escapeAttr(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:site_name" content="AIBTC">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${X_HANDLE}">
<meta name="twitter:title" content="${escapeAttr(ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(ogImage)}">
<link rel="canonical" href="${escapeAttr(canonicalUrl)}">
</head>
<body></body>
</html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        Vary: "User-Agent",
      },
    });

    // Cache the rendered HTML in caches.default for 5 minutes to amortize
    // D1 read + HTML build across repeated crawler hits for the same agent.
    // The cached clone keeps Vary: User-Agent so downstream shared caches
    // still respect the User-Agent gate on cache hits — removing Vary from
    // the stored entry would allow shared caches to serve the crawler-only
    // HTML to non-crawler clients. Cache-Control is tightened to max-age=300
    // (5 min internal TTL) for the stored entry; the live response retains
    // the broader s-maxage=3600 directive for zone-level CDN caches.
    // The put is non-blocking via ctx.waitUntil so the client sees the
    // response immediately without waiting for the cache write to complete.
    // On put failure we still return the live response — cache is never a
    // hard dep.
    if (cacheStore) {
      try {
        const cachedClone = new Response(response.clone().body, {
          status: response.status,
          headers: new Headers(response.headers),
        });
        cachedClone.headers.set("Cache-Control", "public, max-age=300");
        const stash = cacheStore.put(new Request(edgeCacheKey), cachedClone);
        if (ctx) {
          ctx.waitUntil(stash);
        } else {
          void stash.catch(() => {
            // Best-effort — TTL expiry will heal naturally.
          });
        }
      } catch {
        // Best-effort — TTL expiry will heal naturally.
      }
    }

    return response;
  } catch {
    return NextResponse.next();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function escapeAttr(str: string): string {
  // escapeHtml already covers &, <, >, ", ' — all characters that can break
  // out of a double-quoted attribute value.
  return escapeHtml(str);
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Crawlers on agent profile pages: return minimal HTML with OG tags in <head>
  if (isCrawler(request) && path.startsWith("/agents/")) {
    return handleCrawlerAgentPage(request, path);
  }

  // Redirect deprecated paths (301 permanent)
  const deprecatedRedirects: Record<string, string> = {
    "/guide/mcp": "/guide",
    "/guide/loop": "/guide",
    "/install/claude": "/install",
  };
  const redirectTarget = deprecatedRedirects[path];
  if (redirectTarget) {
    return NextResponse.redirect(new URL(redirectTarget, request.url), 301);
  }

  // Paths that serve different content for CLI (curl/wget) vs browser.
  // Both branches must set Vary: User-Agent so shared caches key on UA.
  const cliRewrites: Record<string, string> = {
    "/": "/llms.txt",
    "/install": "/install/loop",
    "/heartbeat": "/heartbeat/cli",
    "/skills": "/skills/md",
  };

  const cliRewriteTarget = cliRewrites[path];

  // Deprecated script paths also serve different content for CLI vs browser
  const cliScriptPaths = new Set(["/vps", "/local", "/update", "/update-skill.sh"]);

  if (!isCLI(request)) {
    if (cliRewriteTarget || cliScriptPaths.has(path)) {
      const response = NextResponse.next();
      response.headers.append("Vary", "User-Agent");
      return response;
    }
    return NextResponse.next();
  }

  // CLI tool detected: rewrite to the appropriate route
  if (cliRewriteTarget) {
    const response = NextResponse.rewrite(
      new URL(cliRewriteTarget, request.url)
    );
    response.headers.append("Vary", "User-Agent");
    return response;
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
        Vary: "User-Agent",
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
    "/guide/loop",
    "/install/claude",
    "/vps",
    "/local",
    "/update",
    "/update-skill.sh",
    "/skills",
    "/heartbeat",
  ],
};
