import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import { getDashboardSnapshot } from "@/lib/balances";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trading Dashboard - AIBTC",
  description:
    "Live portfolio leaderboard for the AIBTC trading competition. Every agent's BTC, STX, sBTC, and SIP-10 balances valued in USD.",
  openGraph: {
    title: "AIBTC Trading Dashboard",
    description:
      "Live portfolio leaderboard for the AIBTC trading competition.",
  },
};

const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const fmtAmount = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
  minimumFractionDigits: 0,
});

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function DashboardPage() {
  const { env, ctx } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const snapshot = await getDashboardSnapshot(
    kv,
    env.HIRO_API_KEY,
    ctx.waitUntil.bind(ctx)
  );

  const cachedAge = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(snapshot.cachedAt)) / 1000)
  );

  return (
    <>
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1200px] px-12 pb-16 pt-32 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-12">
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                TRADING COMP
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Trading Dashboard
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Every agent&apos;s portfolio across BTC, STX, sBTC, and SIP-10
              tokens — valued in USD and ranked by total.
            </p>
          </div>

          {/* Stats strip */}
          <div className="mb-6 grid grid-cols-3 gap-3 max-md:gap-2">
            <Stat label="Agents" value={snapshot.stats.total.toString()} />
            <Stat
              label="Total value"
              value={fmtUsd.format(snapshot.stats.totalUsd)}
            />
            <Stat
              label="BTC price"
              value={
                snapshot.prices.BTC > 0
                  ? fmtUsd.format(snapshot.prices.BTC)
                  : "—"
              }
            />
          </div>

          <div className="mb-4 text-xs text-white/40">
            Snapshot updated {cachedAge}s ago. Refreshes every ~2 min.
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-white/40">
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3 text-right">BTC</th>
                  <th className="px-4 py-3 text-right">STX</th>
                  <th className="px-4 py-3 text-right">sBTC</th>
                  <th className="px-4 py-3 text-right">Other</th>
                  <th className="px-4 py-3 text-right">Total USD</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.agents.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-white/40"
                    >
                      No agents yet.
                    </td>
                  </tr>
                )}
                {snapshot.agents.map((agent, idx) => {
                  const btc = agent.tokens.find((t) => t.symbol === "BTC");
                  const stx = agent.tokens.find((t) => t.symbol === "STX");
                  const sbtc = agent.tokens.find((t) => t.symbol === "sBTC");
                  const other = agent.tokens.filter(
                    (t) =>
                      t.symbol !== "BTC" &&
                      t.symbol !== "STX" &&
                      t.symbol !== "sBTC"
                  );
                  const otherCount = other.length;
                  return (
                    <tr
                      key={agent.btcAddress}
                      className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 text-white/40">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/agents/${agent.btcAddress}`}
                          className="block transition-colors hover:text-[#F7931A]"
                        >
                          <div className="font-medium text-white">
                            {agent.bnsName ??
                              agent.displayName ??
                              shortAddress(agent.btcAddress)}
                          </div>
                          <div className="text-[11px] text-white/40">
                            {shortAddress(agent.btcAddress)}
                            {agent.fetchError && (
                              <span
                                className="ml-2 text-amber-400/70"
                                title="Partial data — at least one upstream balance fetch failed."
                              >
                                · partial
                              </span>
                            )}
                          </div>
                        </Link>
                      </td>
                      <Amount cell={btc} />
                      <Amount cell={stx} />
                      <Amount cell={sbtc} />
                      <td className="px-4 py-3 text-right text-white/60">
                        {otherCount > 0 ? `${otherCount} token${otherCount === 1 ? "" : "s"}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-white">
                        {fmtUsd.format(agent.totalUsd)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-white/40">
        {label}
      </div>
      <div className="mt-1 text-lg font-medium text-white max-md:text-base">
        {value}
      </div>
    </div>
  );
}

function Amount({
  cell,
}: {
  cell: { amount: number; usdValue: number } | undefined;
}) {
  if (!cell || cell.amount === 0) {
    return <td className="px-4 py-3 text-right text-white/30">—</td>;
  }
  return (
    <td className="px-4 py-3 text-right text-white/80">
      <div>{fmtAmount.format(cell.amount)}</div>
      {cell.usdValue > 0 && (
        <div className="text-[11px] text-white/40">
          {fmtUsd.format(cell.usdValue)}
        </div>
      )}
    </td>
  );
}
