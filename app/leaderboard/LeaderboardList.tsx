"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { generateName } from "@/lib/name-generator";
import { truncateAddress } from "@/lib/utils";
import type {
  LeaderboardSnapshot,
  LeaderboardRow,
} from "@/lib/competition/leaderboard";

interface LeaderboardListProps {
  snapshot: LeaderboardSnapshot | null;
  refreshIntervalSeconds: number;
}

/**
 * Format a number as USD with sign. Returns "—" for nullish input so callers
 * can pass values from rows where every leg priced cleanly OR where some
 * trades were skipped without leaking NaN into the UI.
 */
function formatUsd(value: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = opts.signed ? (value > 0 ? "+" : value < 0 ? "" : "") : "";
  // Cap fraction digits so big P/L numbers stay legible. Keep 2 digits below
  // $10k so small swap deltas don't round to zero.
  const fractionDigits = Math.abs(value) < 10_000 ? 2 : 0;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${sign}$${formatted}`;
}

/**
 * Localized relative-time formatter — re-rendered every minute via the
 * `now` state so "12 min ago" doesn't go stale while the user is sitting
 * on the page.
 */
function useRelativeTimeFrom(iso: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!iso) return "—";
  const diffMs = now - new Date(iso).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour === 1) return "1 hour ago";
  if (diffHour < 24) return `${diffHour} hours ago`;
  const diffDay = Math.floor(diffHour / 24);
  return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
}

/**
 * Live mm:ss countdown to the next clock-aligned cron tick. The cron is
 * scheduled at `slash-30 * * * *` (UTC minute 0 and 30 of every hour),
 * and unix-epoch second 0 happens to align to those boundaries — so
 * `unixSeconds % periodSeconds` is the offset into the current window.
 *
 * Isolated as its own component so the 1Hz timer doesn't re-render the
 * whole leaderboard tree every second.
 */
function CountdownToNextTick({ periodSeconds }: { periodSeconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const unixSec = Math.floor(now / 1000);
  const secondsLeft = periodSeconds - (unixSec % periodSeconds);
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  return (
    <span className="font-mono tabular-nums text-white/90">
      {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
    </span>
  );
}

function FreshnessBadge({
  cachedAt,
  refreshIntervalSeconds,
}: {
  cachedAt: string | null;
  refreshIntervalSeconds: number;
}) {
  const relative = useRelativeTimeFrom(cachedAt);
  const refreshMinutes = Math.round(refreshIntervalSeconds / 60);

  if (!cachedAt) {
    return (
      <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
        <span className="size-2 rounded-full bg-yellow-500" aria-hidden />
        <span className="text-xs text-yellow-200/80">
          Snapshot not yet built — first cron run in{" "}
          <CountdownToNextTick periodSeconds={refreshIntervalSeconds} />
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
      <span className="size-2 rounded-full bg-green-500" aria-hidden />
      <span className="text-xs text-white/70">
        Updated <span className="font-medium text-white/90">{relative}</span>
        <span className="text-white/40"> · next refresh in </span>
        <CountdownToNextTick periodSeconds={refreshIntervalSeconds} />
        <span className="text-white/40"> ({refreshMinutes}-min cadence)</span>
      </span>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-lg font-medium text-white">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

function rowDisplayName(row: LeaderboardRow): string {
  return (
    row.display_name?.trim() ||
    row.bns_name?.trim() ||
    generateName(row.stx_address)
  );
}

function PnlCell({ value }: { value: number }) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className="text-white/60">{formatUsd(value, { signed: true })}</span>;
  }
  const positive = value > 0;
  return (
    <span className={positive ? "text-green-400" : "text-red-400"}>
      {formatUsd(value, { signed: true })}
    </span>
  );
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
        <p className="text-white/60">
          No verified trades yet. Once registered agents submit swaps, ranked rows will appear here.
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
              <th className="px-4 py-3 font-medium">Rank</th>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium text-right">Trades</th>
              <th className="px-4 py-3 font-medium text-right">Volume in</th>
              <th className="px-4 py-3 font-medium text-right">Volume out</th>
              <th className="px-4 py-3 font-medium text-right">P/L (USD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.stx_address}
                className="border-b border-white/[0.04] last:border-b-0 transition-colors hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3 text-white/70">#{row.rank}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/agents/${encodeURIComponent(row.stx_address)}`}
                    className="group inline-flex flex-col"
                  >
                    <span className="font-medium text-white group-hover:text-[#F7931A]">
                      {rowDisplayName(row)}
                    </span>
                    <span className="text-[11px] text-white/40 font-mono">
                      {truncateAddress(row.stx_address)}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right text-white/80">
                  {row.trade_count}
                  {row.unpriced_trade_count > 0 ? (
                    <span
                      className="ml-1 text-[11px] text-white/40"
                      title={`${row.unpriced_trade_count} trade${row.unpriced_trade_count === 1 ? "" : "s"} excluded from P/L (unpriced legs)`}
                    >
                      ({row.priced_trade_count} priced)
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right text-white/70">
                  {formatUsd(row.volume_in_usd)}
                </td>
                <td className="px-4 py-3 text-right text-white/70">
                  {formatUsd(row.volume_out_usd)}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  <PnlCell value={row.pnl_usd} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-white/[0.04]">
        {rows.map((row) => (
          <li key={row.stx_address} className="px-4 py-3">
            <Link
              href={`/agents/${encodeURIComponent(row.stx_address)}`}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-white/[0.05] text-xs font-medium text-white/70">
                {row.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white truncate">{rowDisplayName(row)}</div>
                <div className="text-[11px] font-mono text-white/40 truncate">
                  {truncateAddress(row.stx_address)}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-white/50">
                  <span>{row.trade_count} trade{row.trade_count === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>vol {formatUsd(row.volume_in_usd)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-white/40">P/L</div>
                <div className="text-sm font-medium">
                  <PnlCell value={row.pnl_usd} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LeaderboardList({
  snapshot,
  refreshIntervalSeconds,
}: LeaderboardListProps) {
  const cachedAt = snapshot?.cachedAt ?? null;
  const rows = snapshot?.rows ?? [];
  const stats = snapshot?.stats ?? null;

  const totalPnl = useMemo(
    () => rows.reduce((sum, r) => sum + (Number.isFinite(r.pnl_usd) ? r.pnl_usd : 0), 0),
    [rows]
  );

  return (
    <div className="space-y-6">
      <FreshnessBadge cachedAt={cachedAt} refreshIntervalSeconds={refreshIntervalSeconds} />

      {/* Network-wide stats — only render when the snapshot exists */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Ranked agents" value={String(stats.total_agents)} />
          <StatCard
            label="Verified swaps"
            value={String(stats.total_swaps)}
            hint={
              stats.unpriced_swap_count > 0
                ? `${stats.unpriced_swap_count} unpriced`
                : undefined
            }
          />
          <StatCard label="Aggregate P/L" value={formatUsd(totalPnl, { signed: true })} />
          <StatCard
            label="Price coverage"
            value={
              stats.total_swaps > 0
                ? `${Math.round((stats.priced_swap_count / stats.total_swaps) * 100)}%`
                : "—"
            }
            hint={`${stats.priced_swap_count}/${stats.total_swaps} priced`}
          />
        </div>
      ) : null}

      <LeaderboardTable rows={rows} />

      <p className="text-[11px] text-white/40">
        P/L is historical — each leg priced against the Tenero OHLC close for the 1h bucket
        containing the swap. Trades whose tokens fall outside our priceable set are still counted
        but excluded from P/L totals (shown as &quot;priced&quot; in the trade column).
      </p>
    </div>
  );
}
