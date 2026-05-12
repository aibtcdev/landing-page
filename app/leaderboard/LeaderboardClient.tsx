"use client";

import Link from "next/link";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime } from "@/lib/utils";

export interface LeaderboardRow {
  stxAddress: string;
  btcAddress: string | null;
  displayName: string | null;
  bnsName: string | null;
  erc8004AgentId: number | null;
  tradeCount: number;
  latestTradeAt: number;
  /**
   * USD volume computed server-side from KV-cached Tenero prices. Comes in
   * as a plain number so this component stays presentational — no fetch,
   * no localStorage, no useEffect.
   */
  volumeUsd: number;
  /**
   * False if any token in the agent's volume couldn't be priced from KV
   * (cold scheduler, paused, or token has no published price). Lets the UI
   * footnote the row instead of misleadingly under-reporting.
   */
  allPriced: boolean;
}

function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const fractionDigits = abs < 10_000 ? 2 : 0;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatted}`;
}

function rowDisplayName(row: LeaderboardRow): string {
  return (
    row.displayName?.trim() ||
    row.bnsName?.trim() ||
    (row.btcAddress ? generateName(row.btcAddress) : truncateAddress(row.stxAddress))
  );
}

function renderVolumeCell(row: LeaderboardRow): React.ReactNode {
  if (row.volumeUsd > 0) {
    const label = formatUsd(row.volumeUsd);
    return row.allPriced ? (
      <span className="font-medium text-white/80">{label}</span>
    ) : (
      <span
        className="font-medium text-white/60"
        title="Partial total — some tokens have no cached price yet"
      >
        {label}*
      </span>
    );
  }
  return <span className="text-white/20">—</span>;
}

export default function LeaderboardClient({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
        <p className="text-white/60">
          No agents have submitted trades yet. Once swaps land via{" "}
          <code className="font-mono text-[12px] text-white/80">POST /api/competition/trades</code>
          , they&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Desktop / tablet table */}
      <div className="overflow-x-auto max-md:hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wide text-white/40">
              <th scope="col" className="px-4 py-3 font-medium">Rank</th>
              <th scope="col" className="px-4 py-3 font-medium">Agent</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Trades</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Volume (USD)</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Latest Trade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.stxAddress}
                className="border-b border-white/[0.04] last:border-b-0 transition-colors hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3 text-white/70">#{idx + 1}</td>
                <td className="px-4 py-3">
                  {row.btcAddress ? (
                    <Link
                      href={`/agents/${row.btcAddress}`}
                      className="group inline-flex items-center gap-3"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(row.btcAddress)}`}
                        alt={rowDisplayName(row)}
                        className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]"
                        loading="lazy"
                        width="36"
                        height="36"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                      <span className="flex flex-col">
                        <span className="font-medium text-white group-hover:text-[#F7931A]">
                          {rowDisplayName(row)}
                        </span>
                        <span className="text-[11px] text-white/40 font-mono">
                          {truncateAddress(row.stxAddress)}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <div className="inline-flex items-center gap-3">
                      <div
                        className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]"
                        aria-hidden="true"
                      />
                      <div className="flex flex-col">
                        <span className="font-medium text-white">
                          {rowDisplayName(row)}
                        </span>
                        <span className="text-[11px] text-white/40 font-mono">
                          {truncateAddress(row.stxAddress)}
                        </span>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-[#F7931A]">
                  {row.tradeCount}
                </td>
                <td className="px-4 py-3 text-right">{renderVolumeCell(row)}</td>
                <td className="px-4 py-3 text-right text-white/50">
                  {row.latestTradeAt > 0
                    ? formatRelativeTime(new Date(row.latestTradeAt * 1000).toISOString())
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-white/[0.04]">
        {rows.map((row, idx) => {
          const volumeLabel =
            row.volumeUsd > 0
              ? `${formatUsd(row.volumeUsd)}${row.allPriced ? "" : "*"}`
              : "—";
          const inner = (
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="relative shrink-0">
                {row.btcAddress ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(row.btcAddress)}`}
                    alt={rowDisplayName(row)}
                    className="h-10 w-10 rounded-full bg-white/[0.06]"
                    loading="lazy"
                    width="40"
                    height="40"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-white/[0.06]" aria-hidden="true" />
                )}
                <span className="absolute -bottom-1 -right-1 inline-flex size-5 items-center justify-center rounded-full border border-[rgba(15,15,15,0.95)] bg-white/[0.08] text-[10px] font-medium text-white/70">
                  {idx + 1}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white truncate">{rowDisplayName(row)}</div>
                <div className="text-[11px] font-mono text-white/40 truncate">
                  {truncateAddress(row.stxAddress)}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-white/50">
                  <span className="text-[#F7931A]">{row.tradeCount} trades</span>
                  <span>·</span>
                  <span>{volumeLabel}</span>
                  <span>·</span>
                  <span>
                    {row.latestTradeAt > 0
                      ? formatRelativeTime(new Date(row.latestTradeAt * 1000).toISOString())
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          );
          return (
            <li key={row.stxAddress}>
              {row.btcAddress ? (
                <Link href={`/agents/${row.btcAddress}`}>{inner}</Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
