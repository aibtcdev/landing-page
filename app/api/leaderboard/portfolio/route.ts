import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDashboardSnapshot } from "@/lib/balances";
import {
  createConsoleLogger,
  createLogger,
  isLogsRPC,
} from "@/lib/logging";

/**
 * GET /api/leaderboard/portfolio — Trading-comp portfolio leaderboard.
 *
 * Returns the full ranked array of Genesis (Level 2+) agents with their
 * BTC L1, STX, and sBTC balances. Sorted sBTC desc → BTC desc → STX desc.
 *
 * Warm/stale public requests read `cache:dashboard:snapshot`. Stale rebuilds
 * run out-of-band via `ctx.waitUntil()`, single-flighted by the
 * `cache:dashboard:snapshot:building` sentinel. A true cold miss still rebuilds
 * synchronously to seed the first snapshot.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("docs") === "1") {
    return NextResponse.json(
      {
        endpoint: "/api/leaderboard/portfolio",
        method: "GET",
        description:
          "Trading-comp portfolio leaderboard. Returns the full ranked array of Genesis (Level 2+) agents — the comp's participant set — with BTC L1, STX, and sBTC balances. Sorted sBTC desc → BTC desc → STX desc. No pagination.",
        queryParameters: {
          docs: {
            type: "string",
            description: "Pass ?docs=1 to return this documentation payload instead of data",
            example: "?docs=1",
          },
        },
        responseFormat: {
          agents: [
            {
              stxAddress: "string",
              btcAddress: "string",
              displayName: "string | null",
              bnsName: "string | null",
              level: "number (2+)",
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
                "string | undefined (set when at least one upstream failed during the rebuild; balance is partial)",
            },
          ],
          stats: {
            total: "number (Genesis agents in the snapshot)",
            partialCount: "number (agents with partial balance data)",
          },
          cachedAt: "string (ISO 8601 — when the snapshot was last rebuilt)",
        },
        notes: [
          "Only Genesis-level agents appear — agents reach Genesis by posting on X via /api/claims/viral.",
          "Tokens with zero balance are dropped from the tokens array — empty wallets show as `tokens: []`.",
          "Sort is by raw integer balance: sBTC desc → BTC desc → STX desc.",
          "Snapshot has a fresh window of 60 s and a hard TTL of 1 h. Stale snapshots are served while an off-request rebuild runs; true cold misses rebuild synchronously to seed KV.",
          "fetchError = 'partial' means at least one upstream (Hiro or mempool.space) failed during that agent's fetch in the most recent rebuild.",
        ],
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      }
    );
  }

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
      ctx?.waitUntil?.bind(ctx),
      logger
    );

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control":
          "public, max-age=15, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
