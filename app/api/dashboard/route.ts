import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DASHBOARD_PAGE_SIZE, getDashboardPage } from "@/lib/balances";
import {
  createConsoleLogger,
  createLogger,
  isLogsRPC,
} from "@/lib/logging";

/**
 * GET /api/dashboard — Trading-comp leaderboard, paginated.
 *
 * Returns one page of agents (default 10) with their BTC L1, STX, and sBTC
 * balances. Each agent's balance is cached in KV (`cache:balance:{btc}`) for
 * 60 seconds, so repeat views are cheap and only the first viewer per minute
 * pays the upstream cost.
 *
 * No big snapshot rebuild. No background work. Each request only fetches
 * balances for the visible page — keeps cold-start fast and scales to any
 * agent count.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("docs") === "1") {
    return NextResponse.json(
      {
        endpoint: "/api/dashboard",
        method: "GET",
        description:
          "Paginated trading-comp leaderboard. Returns one page (default 10) of agents with their BTC L1, STX, and sBTC balances. Each agent's balance is KV-cached for 60 s.",
        queryParameters: {
          docs: {
            type: "string",
            description: "Pass ?docs=1 to return this documentation payload instead of data",
            example: "?docs=1",
          },
          limit: {
            type: "number",
            description: "Page size (1–100; default 10)",
            default: DASHBOARD_PAGE_SIZE,
            example: "?limit=10",
          },
          offset: {
            type: "number",
            description: "Number of agents to skip",
            default: 0,
            example: "?offset=10",
          },
        },
        responseFormat: {
          agents: [
            {
              stxAddress: "string",
              btcAddress: "string",
              displayName: "string | null",
              bnsName: "string | null",
              level: "number (0-2)",
              levelName: "string",
              tokens: [
                {
                  symbol: "BTC | STX | sBTC",
                  balance: "string (raw integer)",
                  decimals: "number (BTC/sBTC = 8, STX = 6)",
                  amount: "number (balance / 10^decimals)",
                },
              ],
              fetchError:
                "string | undefined (set when at least one upstream failed; balance is partial)",
            },
          ],
          pagination: {
            total: "number (total registered agents)",
            limit: "number",
            offset: "number",
            hasMore: "boolean",
          },
        },
        notes: [
          "Tokens with zero balance are dropped from the tokens array — empty wallets show as `tokens: []`.",
          "Pagination order is `verifiedAt` desc (newest first), matching /api/agents.",
          "fetchError = 'partial' means at least one upstream (Hiro or mempool.space) failed during the fetch. The 60-s sentinel will retry after that window.",
          "Each agent balance is KV-cached for 60 s — repeat requests for the same page are cheap KV reads, no upstream traffic.",
        ],
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      }
    );
  }

  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10) || DASHBOARD_PAGE_SIZE, 1), 100)
    : DASHBOARD_PAGE_SIZE;
  const offset = offsetParam
    ? Math.max(parseInt(offsetParam, 10) || 0, 0)
    : 0;

  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const rayId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const logger =
      env.LOGS && isLogsRPC(env.LOGS)
        ? createLogger(env.LOGS, ctx, {
            rayId,
            path: request.nextUrl.pathname,
          })
        : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

    const page = await getDashboardPage(
      kv,
      env.HIRO_API_KEY,
      offset,
      limit,
      logger
    );

    return NextResponse.json(
      {
        agents: page.agents,
        pagination: {
          total: page.total,
          limit,
          offset,
          hasMore: page.hasMore,
        },
      },
      {
        headers: {
          // Edge cache for 30 s; SWR up to 5 min while we revalidate.
          // Per-agent KV cache is the real freshness lever (60 s).
          "Cache-Control":
            "public, max-age=15, s-maxage=30, stale-while-revalidate=300",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch dashboard" },
      { status: 500 }
    );
  }
}
