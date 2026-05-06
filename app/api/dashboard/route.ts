import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDashboardSnapshot } from "@/lib/balances";
import {
  createConsoleLogger,
  createLogger,
  isLogsRPC,
} from "@/lib/logging";

/**
 * GET /api/dashboard — Trading-comp leaderboard.
 *
 * Returns every registered agent with their full token portfolio (BTC L1,
 * STX, sBTC, SIP-10s) and a USD-summed total, sorted by total descending.
 *
 * Caching strategy (B3 runbook patterns):
 * - Edge: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
 *   Most requests never invoke the worker.
 * - Origin (KV): single `cache:dashboard` snapshot with SWR — 2 min fresh,
 *   10 min hard, sentinel-gated rebuild. See `lib/balances/snapshot.ts`.
 * - Per-agent upstream failures (Hiro / mempool.space) get a 60s sentinel
 *   so one slow agent doesn't slow every rebuild.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("docs") === "1") {
    return NextResponse.json(
      {
        endpoint: "/api/dashboard",
        method: "GET",
        description:
          "Trading-comp leaderboard. Returns every registered agent with their full token portfolio (BTC L1, STX, sBTC, SIP-10s) plus a USD-summed total, sorted by total value descending.",
        queryParameters: {
          docs: {
            type: "string",
            description:
              "Pass ?docs=1 to return this documentation payload instead of data",
            example: "?docs=1",
          },
          limit: {
            type: "number",
            description: "Maximum number of agents to return per page",
            default: 100,
            maximum: 500,
            example: "?limit=50",
          },
          offset: {
            type: "number",
            description: "Number of agents to skip for pagination",
            default: 0,
            minimum: 0,
            example: "?offset=50",
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
                  symbol: "string (BTC | STX | sBTC | SIP-10 token name)",
                  contract: "string | undefined (Stacks contract id)",
                  balance: "string (raw integer)",
                  decimals: "number",
                  amount: "number (balance / 10^decimals)",
                  priceUsd: "number (per-unit USD price; 0 if unknown)",
                  usdValue: "number (amount * priceUsd)",
                },
              ],
              totalUsd: "number (sum of all token usdValues)",
              fetchError:
                "string | undefined (set when at least one upstream failed; balance is partial)",
            },
          ],
          prices: {
            BTC: "number (USD)",
            STX: "number (USD)",
            sBTC: "number (USD; equal to BTC)",
          },
          stats: {
            total: "number",
            totalUsd: "number",
            pricedAt: "string (ISO 8601)",
          },
          cachedAt: "string (ISO 8601)",
          pagination: {
            total: "number",
            limit: "number",
            offset: "number",
            hasMore: "boolean",
          },
        },
        notes: [
          "Snapshot is cached for ~2 min at the origin and ~60s at the edge. Read freshness via cachedAt and stats.pricedAt.",
          "SIP-10 tokens we cannot price are returned with priceUsd = 0 — they don't contribute to totalUsd.",
          "fetchError = 'partial' means at least one upstream (Hiro or mempool.space) failed during the rebuild for that agent. The 60s sentinel will retry on the next rebuild after that window.",
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
    ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500)
    : 100;
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

    const snapshot = await getDashboardSnapshot(
      kv,
      env.HIRO_API_KEY,
      ctx.waitUntil.bind(ctx),
      logger
    );

    const total = snapshot.agents.length;
    const paginated = snapshot.agents.slice(offset, offset + limit);

    return NextResponse.json(
      {
        agents: paginated,
        prices: snapshot.prices,
        stats: snapshot.stats,
        cachedAt: snapshot.cachedAt,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch dashboard: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
