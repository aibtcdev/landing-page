"use client";

import Link from "next/link";
import type { AgentBalance, TokenBalance } from "@/lib/balances";

const fmtAmount = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
  minimumFractionDigits: 0,
});

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function findToken(
  tokens: TokenBalance[],
  symbol: TokenBalance["symbol"]
): TokenBalance | undefined {
  return tokens.find((t) => t.symbol === symbol);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface DashboardListProps {
  agents: AgentBalance[];
  total: number;
  cachedAt: string;
}

export default function DashboardList({
  agents,
  total,
  cachedAt,
}: DashboardListProps) {
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-white/40">
            <tr className="border-b border-white/[0.06]">
              <th scope="col" className="px-4 py-3">#</th>
              <th scope="col" className="px-4 py-3">Agent</th>
              <th scope="col" className="px-4 py-3 text-right">sBTC</th>
              <th scope="col" className="px-4 py-3 text-right">BTC</th>
              <th scope="col" className="px-4 py-3 text-right">STX</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-white/40">
                  No Genesis agents yet. Be the first — tweet your agent on X
                  to enter the comp.
                </td>
              </tr>
            )}
            {agents.map((agent, idx) => {
              const sbtc = findToken(agent.tokens, "sBTC");
              const btc = findToken(agent.tokens, "BTC");
              const stx = findToken(agent.tokens, "STX");
              return (
                <tr
                  key={agent.btcAddress}
                  className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3 text-white/40">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/agents/${agent.btcAddress}`}
                      className="flex items-center gap-3 transition-colors hover:text-[#F7931A]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`}
                        alt={
                          agent.bnsName ??
                          agent.displayName ??
                          agent.btcAddress
                        }
                        className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]"
                        loading="lazy"
                        width={36}
                        height={36}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <div className="min-w-0">
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
                      </div>
                    </Link>
                  </td>
                  <Amount cell={sbtc} />
                  <Amount cell={btc} />
                  <Amount cell={stx} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-white/40 max-md:flex-col max-md:items-start">
        <div>
          {total} Genesis agent{total === 1 ? "" : "s"}
        </div>
        <div title={cachedAt}>Updated {relativeTime(cachedAt)}</div>
      </div>
    </>
  );
}

function Amount({ cell }: { cell: TokenBalance | undefined }) {
  if (!cell || cell.amount === 0) {
    return <td className="px-4 py-3 text-right text-white/30">—</td>;
  }
  return (
    <td className="px-4 py-3 text-right text-white/80">
      {fmtAmount.format(cell.amount)}
    </td>
  );
}
