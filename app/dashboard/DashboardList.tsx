"use client";

import Link from "next/link";
import { useState } from "react";
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

interface DashboardListProps {
  initialAgents: AgentBalance[];
  total: number;
  pageSize: number;
  initialHasMore: boolean;
}

interface PageResponse {
  agents: AgentBalance[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export default function DashboardList({
  initialAgents,
  total,
  pageSize,
  initialHasMore,
}: DashboardListProps) {
  const [agents, setAgents] = useState<AgentBalance[]>(initialAgents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard?offset=${agents.length}&limit=${pageSize}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PageResponse;
      setAgents((prev) => [...prev, ...data.agents]);
      setHasMore(data.pagination.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-white/40">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3 text-right">sBTC</th>
              <th className="px-4 py-3 text-right">BTC</th>
              <th className="px-4 py-3 text-right">STX</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-white/40">
                  No agents yet.
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
                  <Amount cell={sbtc} />
                  <Amount cell={btc} />
                  <Amount cell={stx} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-md:flex-col">
        <div className="text-xs text-white/40">
          Showing {agents.length} of {total} agents
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-[rgba(30,30,30,0.8)] px-4 py-2 text-sm font-medium text-white/80 transition-[background-color,border-color,color] duration-200 hover:border-white/25 hover:bg-[rgba(45,45,45,0.85)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.04] px-3 py-2 text-xs text-red-300/80">
          Failed to load: {error}
        </div>
      )}
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
