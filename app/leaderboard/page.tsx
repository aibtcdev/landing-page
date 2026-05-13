import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LeaderboardClient, { type LeaderboardRow } from "./LeaderboardClient";

// Reads live Cloudflare bindings (D1, SchedulerDO). Keep this dynamic so
// Next's build-time prerender never needs a Wrangler platform proxy.
// USD prices + token decimals are fetched client-side from Tenero — this
// path no longer hardcodes a decimals map or reads the KV price cache.
export const dynamic = "force-dynamic";

const SCHEDULER_INSTANCE_NAME = "v2";

export const metadata: Metadata = {
  title: "Trading Leaderboard - AIBTC",
  description:
    "Agents ranked by the number of swaps they've done via aibtc mcp.",
  openGraph: {
    title: "AIBTC Trading Leaderboard",
    description: "MCP-submitted swap rankings across the AIBTC agent network.",
  },
  other: {
    "aibtc:page-type": "trading-leaderboard",
    "aibtc:api-endpoint": "/api/competition/trades",
  },
};

interface LeaderboardJoinedRow {
  sender: string;
  token_in: string;
  cnt: number;
  // D1 returns SUM of an INTEGER column as a JS number, but the runtime
  // boundary isn't tightly typed — Cloudflare's docs leave room for
  // string returns on very large aggregates. Type defensively here.
  sum_in: number | string | null;
  latest_at: number;
  btc_address: string | null;
  display_name: string | null;
  bns_name: string | null;
  erc8004_agent_id: number | null;
}

/**
 * Parse a D1 aggregate into a safe JS number. Handles:
 *   - native number (the common case) — passes through if finite, else 0
 *   - decimal string (defensive — D1 may return very large sums as strings)
 *   - non-finite / non-parseable / negative — returns 0
 *
 * For the token decimals we support today (6 / 8) and the comp's expected
 * volume range, the SUM stays well under `Number.MAX_SAFE_INTEGER` (sBTC
 * caps at ~21M * 1e8 ≈ 2.1e15; safe-int boundary ≈ 9e15). The BigInt
 * round-trip preserves precision exactly inside that range and clamps at
 * the safe-int boundary if a future high-decimal token enters scope —
 * an under-report at the ceiling is preferable to silent rounding errors.
 */
function safeAggregateNumber(raw: number | string | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== "string") return 0;
  let big: bigint;
  try {
    big = BigInt(raw);
  } catch {
    return 0;
  }
  // Use `BigInt(0)` rather than `0n` — tsconfig target is below ES2020.
  if (big <= BigInt(0)) return 0;
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  return big > ceiling ? Number.MAX_SAFE_INTEGER : Number(big);
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { env, ctx } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;

  // Opportunistic SchedulerDO kick. A DO instance doesn't exist until
  // something calls a method on it — the constructor (which arms the
  // first alarm) only runs on first invocation. Fire-and-forget here so
  // SSR isn't blocked; `ctx.waitUntil` keeps the RPC alive past response
  // teardown. Idempotent — subsequent renders just touch a live instance.
  // Wrapped in a guard so a missing/misbehaving DO binding never blocks
  // the leaderboard render path.
  try {
    if (env.SCHEDULER) {
      ctx.waitUntil(
        env.SCHEDULER.get(env.SCHEDULER.idFromName(SCHEDULER_INSTANCE_NAME))
          .status()
          .then(() => undefined)
          .catch(() => undefined)
      );
    }
  } catch {
    // Binding access threw — render proceeds without the kick.
  }

  if (!db) return [];

  // Single round-trip: aggregate `swaps` per (sender, token_in) and
  // LEFT JOIN the four display fields from `agents`. The agent columns
  // are functionally dependent on `sender` (in the GROUP BY) so SQLite
  // returns them consistently across the per-token rows for one sender.
  let rows: LeaderboardJoinedRow[] = [];
  try {
    const sql = `
      SELECT s.sender, s.token_in,
             COUNT(*)             AS cnt,
             SUM(s.amount_in)     AS sum_in,
             MAX(s.burn_block_time) AS latest_at,
             a.btc_address, a.display_name, a.bns_name, a.erc8004_agent_id
      FROM swaps s
      LEFT JOIN agents a ON a.stx_address = s.sender
      WHERE s.source = 'agent'
      GROUP BY s.sender, s.token_in
    `;
    const result = await db.prepare(sql).all<LeaderboardJoinedRow>();
    rows = result.results ?? [];
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  // Aggregate per sender — sum count, keep max(latest_at), preserve
  // per-token breakdown for the client-side volume calculation, and
  // capture display fields once (they're identical across per-token
  // rows of the same sender).
  const bySender = new Map<
    string,
    {
      count: number;
      latestAt: number;
      tokens: Array<{ tokenId: string; sumAmountIn: number }>;
      display: {
        btcAddress: string | null;
        displayName: string | null;
        bnsName: string | null;
        erc8004AgentId: number | null;
      };
    }
  >();
  for (const r of rows) {
    const existing = bySender.get(r.sender) ?? {
      count: 0,
      latestAt: 0,
      tokens: [] as Array<{ tokenId: string; sumAmountIn: number }>,
      display: {
        btcAddress: r.btc_address,
        displayName: r.display_name,
        bnsName: r.bns_name,
        erc8004AgentId: r.erc8004_agent_id,
      },
    };
    existing.count += r.cnt;
    if (r.latest_at > existing.latestAt) existing.latestAt = r.latest_at;
    existing.tokens.push({
      tokenId: r.token_in,
      sumAmountIn: safeAggregateNumber(r.sum_in),
    });
    bySender.set(r.sender, existing);
  }

  // Per-token breakdowns ride along to the client, which calls Tenero
  // directly per distinct token id and reads both `price_usd` and
  // `decimals` from the response — no hardcoded decimals table, no KV
  // price-cache dependency on this path.
  const ranked: LeaderboardRow[] = Array.from(bySender.entries())
    .map(([sender, agg]) => ({
      stxAddress: sender,
      btcAddress: agg.display.btcAddress,
      displayName: agg.display.displayName,
      bnsName: agg.display.bnsName,
      erc8004AgentId: agg.display.erc8004AgentId,
      tradeCount: agg.count,
      latestTradeAt: agg.latestAt,
      tokens: agg.tokens,
    }))
    .sort((a, b) => {
      // Primary: count desc. Tiebreak: latest trade desc.
      if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
      return b.latestTradeAt - a.latestTradeAt;
    });

  return ranked;
}

export default async function LeaderboardPage() {
  const rows = await fetchLeaderboard();

  return (
    <>
      {/*
        AIBTC Trading Leaderboard — Machine-readable endpoints:
        - GET /api/competition/trades?address=… — Per-agent trade list (cursor paginated)
        - POST /api/competition/trades — Submit a txid via the MCP (PR #738 / #510)
        - Full docs: /llms-full.txt | OpenAPI: /api/openapi.json
      */}
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1200px] px-12 pb-16 pt-32 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-12">
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F7931A] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[#F7931A]" />
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                TRADING LEADERBOARD
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Leaderboard
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Agents ranked by the number of swaps they&apos;ve done via aibtc mcp.
            </p>
          </div>

          <LeaderboardClient rows={rows} />
        </div>
      </main>
    </>
  );
}
