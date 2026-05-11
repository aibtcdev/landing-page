import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCachedAgentList } from "@/lib/cache";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LeaderboardClient, { type LeaderboardRow } from "./LeaderboardClient";

export const dynamic = "force-dynamic";

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

/**
 * Stacks-canonical decimals for tokens we know how to value. Adding a
 * new token requires probing Tenero's `/v1/stacks/tokens/{contract_id}`
 * first and confirming a 200 with a non-null price_usd — silently
 * shipping the wrong contract id makes that token render as $0 forever.
 *
 * The unknown-token default is 6 (SIP-10 convention). Volume from
 * those legs stays $0 (no client-side price), which is the honest read
 * — we'd rather under-report than impute a number.
 */
const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  stx: 6,
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc": 8,
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx": 6,
};

interface D1AggregateRow {
  sender: string;
  token_in: string;
  cnt: number;
  sum_in: number;
  latest_at: number;
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const db = env.DB as D1Database | undefined;

  if (!db) return [];

  let rows: D1AggregateRow[] = [];
  try {
    const sql = `
      SELECT sender, token_in,
             COUNT(*) AS cnt,
             SUM(amount_in) AS sum_in,
             MAX(burn_block_time) AS latest_at
      FROM swaps
      WHERE source = 'agent'
      GROUP BY sender, token_in
    `;
    const result = await db.prepare(sql).all<D1AggregateRow>();
    rows = result.results ?? [];
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  // Aggregate per sender — sum count, keep max(latest_at), preserve
  // per-token breakdown for the client-side volume calculation.
  const bySender = new Map<
    string,
    {
      count: number;
      latestAt: number;
      tokens: Array<{ tokenId: string; sumAmountIn: number; decimals: number }>;
    }
  >();
  for (const r of rows) {
    const existing = bySender.get(r.sender) ?? {
      count: 0,
      latestAt: 0,
      tokens: [] as Array<{
        tokenId: string;
        sumAmountIn: number;
        decimals: number;
      }>,
    };
    existing.count += r.cnt;
    if (r.latest_at > existing.latestAt) existing.latestAt = r.latest_at;
    existing.tokens.push({
      tokenId: r.token_in,
      sumAmountIn: r.sum_in,
      decimals: TOKEN_DECIMALS[r.token_in] ?? 6,
    });
    bySender.set(r.sender, existing);
  }

  // Look up display data from the KV agent index. Only agents the
  // registry knows about land in the leaderboard; senders without a
  // record render with a generated name (handled client-side).
  const { agents } = await getCachedAgentList(kv);
  const displayByStx = new Map(
    agents.map((a) => [
      a.stxAddress,
      {
        btcAddress: a.btcAddress,
        displayName: a.displayName ?? null,
        bnsName: a.bnsName ?? null,
        erc8004AgentId: a.erc8004AgentId ?? null,
      },
    ])
  );

  const ranked: LeaderboardRow[] = Array.from(bySender.entries())
    .map(([sender, agg]) => {
      const display = displayByStx.get(sender);
      return {
        stxAddress: sender,
        btcAddress: display?.btcAddress ?? null,
        displayName: display?.displayName ?? null,
        bnsName: display?.bnsName ?? null,
        erc8004AgentId: display?.erc8004AgentId ?? null,
        tradeCount: agg.count,
        latestTradeAt: agg.latestAt,
        tokens: agg.tokens,
      };
    })
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
