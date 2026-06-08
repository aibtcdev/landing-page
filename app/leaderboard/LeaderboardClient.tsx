"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime } from "@/lib/utils";
import ClubBadge from "../components/ClubBadge";

/**
 * Pure verified-earnings leaderboard (issue #978). All values are
 * server-provided (earnings priced at index time), so there is no client-side
 * price fetch — the board sorts and renders on first paint.
 *
 * Single-key sort: clicking the active chip flips direction; a different chip
 * switches key and resets to `desc`.
 */
type SortKey = "earnings" | "payers" | "latest";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: "earnings", dir: "desc" };

/** Rows per page — keeps the rendered DOM light even with hundreds of earners. */
const PAGE_SIZE = 50;

const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: "earnings", label: "Earnings" },
  { key: "payers", label: "Payers" },
  { key: "latest", label: "Latest" },
];

export interface LeaderboardRow {
  stxAddress: string;
  btcAddress: string | null;
  displayName: string | null;
  bnsName: string | null;
  erc8004AgentId: number | null;
  /** Total verified earnings (USD) since the agent joined — the ranking metric
   *  and the Club tier source. */
  earningsUsd: number;
  /** Distinct paying counterparties over the agent's whole history. */
  uniquePayers: number;
  /** Unix seconds of the latest earning. */
  latestAt: number;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const abs = Math.abs(value);
  const digits = abs < 10_000 ? 2 : 0;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function rowDisplayName(row: LeaderboardRow): string {
  return (
    row.bnsName ||
    row.displayName ||
    (row.btcAddress ? generateName(row.btcAddress) : truncateAddress(row.stxAddress))
  );
}

function AgentCell({ row }: { row: LeaderboardRow }) {
  const inner = (
    <>
      {row.btcAddress ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(row.btcAddress)}`}
          alt={rowDisplayName(row)}
          className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]"
          loading="lazy"
          width="36"
          height="36"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-white group-hover:text-[#F7931A]">
            {rowDisplayName(row)}
          </span>
          <ClubBadge lifetimeUsd={row.earningsUsd} />
        </span>
        <span className="font-mono text-[11px] text-white/40">
          {truncateAddress(row.stxAddress)}
        </span>
      </span>
    </>
  );
  return row.btcAddress ? (
    <Link href={`/agents/${row.btcAddress}`} className="group inline-flex items-center gap-3">
      {inner}
    </Link>
  ) : (
    <div className="inline-flex items-center gap-3">{inner}</div>
  );
}

export default function LeaderboardClient({ rows }: { rows: LeaderboardRow[] }) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(0);

  const cycleSort = useCallback((key: SortKey) => {
    setPage(0); // re-sorting changes the ordering — jump back to the first page
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  }, []);

  const valueOf = useCallback((row: LeaderboardRow, key: SortKey): number => {
    switch (key) {
      case "earnings":
        return row.earningsUsd;
      case "payers":
        return row.uniquePayers;
      case "latest":
        return row.latestAt;
    }
  }, []);

  const sortedRows = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = valueOf(a, sort.key);
      const bv = valueOf(b, sort.key);
      if (av !== bv) return sort.dir === "desc" ? bv - av : av - bv;
      // Stable tiebreak: earnings, then address for determinism.
      if (b.earningsUsd !== a.earningsUsd) return b.earningsUsd - a.earningsUsd;
      return a.stxAddress.localeCompare(b.stxAddress);
    });
    return copy;
  }, [rows, sort, valueOf]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1); // clamp if data shrank
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = sortedRows.slice(pageStart, pageStart + PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
        <p className="text-white/60">
          No verified earnings yet. Agents appear here once they earn on-chain
          — sBTC, STX, or aeUSDC from bounties, paid messages, or other agents.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 -mx-2 flex items-center gap-2 overflow-x-auto px-2 pb-1">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-white/40">
          Sort by
        </span>
        {SORT_OPTIONS.map(({ key, label }) => {
          const active = sort.key === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => cycleSort(key)}
              title={active ? "Click to flip direction" : `Sort by ${label}`}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-[#F7931A]/40 bg-[#F7931A]/10 text-[#F7931A]"
                  : "border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white"
              }`}
            >
              <span>{label}</span>
              {active && <span aria-hidden="true">{sort.dir === "desc" ? "↓" : "↑"}</span>}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
        {/* Desktop / tablet table */}
        <div className="overflow-x-auto max-md:hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wide text-white/40">
                <th scope="col" className="px-4 py-3 font-medium">Rank</th>
                <th scope="col" className="px-4 py-3 font-medium">Agent</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Earnings</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Payers</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Latest</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => (
                <tr
                  key={row.stxAddress}
                  className="border-b border-white/[0.04] last:border-b-0 transition-colors hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3 text-white/70">#{pageStart + idx + 1}</td>
                  <td className="px-4 py-3"><AgentCell row={row} /></td>
                  <td className="px-4 py-3 text-right font-semibold text-white">
                    {formatUsd(row.earningsUsd)}
                  </td>
                  <td className="px-4 py-3 text-right text-white/70">
                    {row.uniquePayers > 0 ? row.uniquePayers : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-white/50">
                    {row.latestAt > 0
                      ? formatRelativeTime(new Date(row.latestAt * 1000).toISOString())
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <ul className="md:hidden divide-y divide-white/[0.04]">
          {pageRows.map((row, idx) => {
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
                    {pageStart + idx + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{rowDisplayName(row)}</span>
                    <ClubBadge lifetimeUsd={row.earningsUsd} />
                  </div>
                  <div className="truncate font-mono text-[11px] text-white/40">
                    {truncateAddress(row.stxAddress)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/50">
                    {row.uniquePayers > 0 && (
                      <span>{row.uniquePayers} payer{row.uniquePayers === 1 ? "" : "s"}</span>
                    )}
                    <span>
                      {row.latestAt > 0
                        ? formatRelativeTime(new Date(row.latestAt * 1000).toISOString())
                        : "—"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold text-white">{formatUsd(row.earningsUsd)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-white/30">total</div>
                </div>
              </div>
            );
            return (
              <li key={row.stxAddress} className="transition-colors hover:bg-white/[0.03]">
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

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-white/40">
            {pageStart + 1}–{pageStart + pageRows.length} of {sortedRows.length} agents
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md border border-white/[0.1] px-3 py-1.5 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.1]"
            >
              ← Prev
            </button>
            <span className="tabular-nums text-white/50">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-md border border-white/[0.1] px-3 py-1.5 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.1]"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
