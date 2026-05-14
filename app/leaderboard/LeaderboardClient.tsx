"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime } from "@/lib/utils";
import Tooltip from "../components/Tooltip";

/**
 * Single-key sort. Clicking the active chip flips direction; clicking a
 * different chip switches the key and resets direction to `desc`.
 * Default mirrors the server-side order in `app/leaderboard/page.tsx`.
 */
type SortKey = "trades" | "volume" | "pnl" | "latest";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: "trades", dir: "desc" };

const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: "trades", label: "Trades" },
  { key: "volume", label: "Volume" },
  { key: "pnl", label: "Unrealized P&L" },
  { key: "latest", label: "Latest" },
];

/**
 * Columns whose values come from `stats` (the client-side Tenero compute)
 * rather than the server-rendered row. Chips for these are disabled until
 * `stats !== null` so users can't sort by a column that's still "…".
 */
const STATS_DEPENDENT_KEYS: ReadonlySet<SortKey> = new Set(["volume", "pnl"]);

export interface LeaderboardTokenAggregate {
  tokenId: string;
  /** Raw on-chain units. Direction is implied by which array this lives in. */
  sumAmount: number;
}

export interface LeaderboardRow {
  stxAddress: string;
  btcAddress: string | null;
  displayName: string | null;
  bnsName: string | null;
  erc8004AgentId: number | null;
  tradeCount: number;
  latestTradeAt: number;
  /**
   * Tokens the agent gave up across their swaps (aggregated `amount_in`
   * grouped by `token_in`). Used to compute volume USD (= notional spent).
   */
  tokensSpent: LeaderboardTokenAggregate[];
  /**
   * Tokens the agent received across their swaps (aggregated `amount_out`
   * grouped by `token_out`). Combined with `tokensSpent` to derive P&L —
   * mark-to-current on net token deltas at end prices.
   */
  tokensReceived: LeaderboardTokenAggregate[];
}

interface RowStats {
  volumeUsd: number;
  pnlUsd: number;
  pnlPercent: number | null;
  allPriced: boolean;
}

interface TokenPrice {
  priceUsd: number;
  decimals: number;
}

const TENERO_API_BASE = "https://api.tenero.io/v1/stacks";
const PRICE_CACHE_PREFIX = "aibtc:tenero-price:";
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedPrice {
  priceUsd: number | null;
  decimals: number | null;
  fetchedAt: number;
}

/**
 * Tenero's `/tokens/{contract_id}` route uses the contract id without the
 * `::asset` suffix; native STX is the literal `"stx"`. Mirrors
 * `tokenIdToTeneroAddress` in `lib/external/tenero/prices.ts` — kept inline
 * here because this component is the only client-side caller.
 */
function tokenIdToTeneroAddress(tokenId: string): string {
  if (tokenId === "stx") return "stx";
  const idx = tokenId.indexOf("::");
  return idx >= 0 ? tokenId.slice(0, idx) : tokenId;
}

/**
 * Read a fresh cached price + decimals from `localStorage`. Returns null
 * on miss, stale, parse error, or storage unavailable (private mode / SSR).
 * Cached `priceUsd: null` is a real value — Tenero confirmed no published
 * price — and is returned as-is when fresh rather than retried.
 */
function readCachedPrice(tokenId: string): CachedPrice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PRICE_CACHE_PREFIX}${tokenId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPrice>;
    if (typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > PRICE_CACHE_TTL_MS) return null;
    const priceUsd =
      typeof parsed.priceUsd === "number" && Number.isFinite(parsed.priceUsd)
        ? parsed.priceUsd
        : null;
    const decimals =
      typeof parsed.decimals === "number" &&
      Number.isFinite(parsed.decimals) &&
      parsed.decimals >= 0
        ? parsed.decimals
        : null;
    return { priceUsd, decimals, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeCachedPrice(
  tokenId: string,
  priceUsd: number | null,
  decimals: number | null
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${PRICE_CACHE_PREFIX}${tokenId}`,
      JSON.stringify({ priceUsd, decimals, fetchedAt: Date.now() })
    );
  } catch {
    // Quota / disabled storage — fine to skip, next render just refetches.
  }
}

async function fetchTokenPrice(tokenId: string): Promise<TokenPrice | null> {
  const cached = readCachedPrice(tokenId);
  if (cached) {
    if (cached.priceUsd != null && cached.decimals != null) {
      return { priceUsd: cached.priceUsd, decimals: cached.decimals };
    }
    return null;
  }

  const addr = tokenIdToTeneroAddress(tokenId);
  try {
    // Per the /api/prices route docstring: "The leaderboard reads decimals
    // directly from Tenero on the client". We split the two reads so the
    // price hop picks up the server-side stablecoin fallback (#849) — which
    // is the only way aeUSDC and USDCx hydrate at $1 when Tenero responds
    // with price_usd: 0 — while decimals continue to come from Tenero, which
    // is the long-standing source of truth for that field.
    const [priceRes, decimalsRes] = await Promise.all([
      fetch(`/api/prices?token=${encodeURIComponent(tokenId)}`, {
        headers: { Accept: "application/json" },
      }),
      fetch(`${TENERO_API_BASE}/tokens/${encodeURIComponent(addr)}`, {
        headers: { Accept: "application/json" },
      }),
    ]);

    if (!priceRes.ok || !decimalsRes.ok) {
      writeCachedPrice(tokenId, null, null);
      return null;
    }

    const priceBody = (await priceRes.json()) as {
      priceUsd?: number | null;
    };
    const priceUsd =
      typeof priceBody.priceUsd === "number" &&
      Number.isFinite(priceBody.priceUsd) &&
      priceBody.priceUsd > 0
        ? priceBody.priceUsd
        : null;

    const decimalsBody = (await decimalsRes.json()) as {
      data?: { decimals?: number | string | null };
    };
    const rawDecimals = decimalsBody.data?.decimals;
    const parsedDecimals =
      typeof rawDecimals === "string" ? parseInt(rawDecimals, 10) : rawDecimals;
    const decimals =
      typeof parsedDecimals === "number" &&
      Number.isFinite(parsedDecimals) &&
      parsedDecimals >= 0
        ? parsedDecimals
        : null;

    writeCachedPrice(tokenId, priceUsd, decimals);
    return priceUsd != null && decimals != null
      ? { priceUsd, decimals }
      : null;
  } catch {
    return null;
  }
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

/**
 * USD formatter that keeps small amounts legible — at a few-cent trade
 * the standard 2-decimal `formatUsd` truncates "-$0.0013" to "-$0.00",
 * which is misleading. Used for the P&L hover so the full magnitude is
 * always visible even when the cell shows just the percentage.
 */
function formatUsdPrecise(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs === 0) return `${sign}$0.00`;
  // For ultra-small magnitudes, pick enough digits to show ~3 sig figs so
  // a value like 1.21e-8 renders "$0.0000000121" instead of being rounded
  // away. `toLocaleString` caps at 20 fraction digits, so we cap there too.
  const fractionDigits =
    abs >= 100 ? 2 :
    abs >= 1 ? 4 :
    abs >= 0.0001 ? 6 :
    Math.min(20, Math.max(6, 2 - Math.floor(Math.log10(abs))));
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${sign}$${formatted}`;
}

function rowDisplayName(row: LeaderboardRow): string {
  return (
    row.displayName?.trim() ||
    row.bnsName?.trim() ||
    (row.btcAddress ? generateName(row.btcAddress) : truncateAddress(row.stxAddress))
  );
}

function renderVolumeCell(
  row: LeaderboardRow,
  stats: RowStats | undefined
): React.ReactNode {
  if (!stats) {
    return (
      <span className="text-white/30" aria-label="Loading USD volume">
        …
      </span>
    );
  }
  if (stats.volumeUsd > 0) {
    const label = formatUsd(stats.volumeUsd);
    return stats.allPriced ? (
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

function renderPnlCell(
  row: LeaderboardRow,
  stats: RowStats | undefined
): React.ReactNode {
  if (!stats) {
    return (
      <span className="text-white/30" aria-label="Loading P&L">
        …
      </span>
    );
  }
  if (stats.volumeUsd <= 0 || stats.pnlPercent == null) {
    return <span className="text-white/20">—</span>;
  }

  const positive = stats.pnlUsd >= 0;
  const color = positive ? "text-[#4dcd5e]" : "text-[#f06464]";
  const pctLabel = `${positive ? "+" : ""}${stats.pnlPercent.toFixed(2)}%`;
  // Tooltip carries the full-precision USD value so a tiny percentage
  // like `-0.03%` still has the underlying magnitude available on hover.
  // The portal-based Tooltip shows instantly (no native ~1s title-attr
  // delay) and survives table-cell clipping.
  const usdDetail = `${positive ? "+" : ""}${formatUsdPrecise(stats.pnlUsd)}`;
  const title = stats.allPriced
    ? usdDetail
    : `${usdDetail} (partial — some tokens couldn't be priced and were excluded)`;

  return (
    <Tooltip text={title}>
      <span className={`font-medium cursor-pointer ${color}`}>
        {pctLabel}
        {!stats.allPriced && "*"}
      </span>
    </Tooltip>
  );
}

/**
 * Compute per-row volume + P&L from per-sender token aggregates and the
 * Tenero price map. Volume USD = Σ(amount_in × price[token_in]), the
 * notional value of what was put at risk. P&L USD = mark-to-end on net
 * token deltas — equivalently Σ(amount_out × price[token_out] -
 * amount_in × price[token_in]).
 *
 * Tokens with no price entry (Tenero doesn't know, fetch failed, or the
 * literal `"unknown"` parser sentinel) are excluded from both totals and
 * flip `allPriced` to false so the UI can footnote the row instead of
 * silently under-reporting.
 */
function computeStats(
  rows: LeaderboardRow[],
  prices: Record<string, TokenPrice | null>
): Map<string, RowStats> {
  const out = new Map<string, RowStats>();
  for (const row of rows) {
    let volumeUsd = 0;
    let receivedUsd = 0;
    let allPriced = true;

    for (const t of row.tokensSpent) {
      const entry = prices[t.tokenId];
      if (!entry) {
        allPriced = false;
        continue;
      }
      volumeUsd += (t.sumAmount / 10 ** entry.decimals) * entry.priceUsd;
    }

    for (const t of row.tokensReceived) {
      const entry = prices[t.tokenId];
      if (!entry) {
        allPriced = false;
        continue;
      }
      receivedUsd += (t.sumAmount / 10 ** entry.decimals) * entry.priceUsd;
    }

    const pnlUsd = receivedUsd - volumeUsd;
    const pnlPercent = volumeUsd > 0 ? (pnlUsd / volumeUsd) * 100 : null;

    out.set(row.stxAddress, { volumeUsd, pnlUsd, pnlPercent, allPriced });
  }
  return out;
}

export default function LeaderboardClient({ rows }: { rows: LeaderboardRow[] }) {
  const [stats, setStats] = useState<Map<string, RowStats> | null>(null);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const cycleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  }, []);

  /**
   * Treat missing stats as `-Infinity` so unpriced rows fall to the bottom
   * of `desc` sorts (and to the top of `asc`, which is the expected
   * "show me the missing/worst data" intent). For P&L we also require
   * volume > 0 — a row with no priced legs has `pnlUsd = 0` mathematically
   * but isn't "neutral," it's "unknown."
   */
  const valueOf = useCallback(
    (row: LeaderboardRow, key: SortKey): number => {
      switch (key) {
        case "trades":
          return row.tradeCount;
        case "latest":
          return row.latestTradeAt;
        case "volume": {
          const s = stats?.get(row.stxAddress);
          return s ? s.volumeUsd : -Infinity;
        }
        case "pnl": {
          const s = stats?.get(row.stxAddress);
          return s && s.volumeUsd > 0 ? s.pnlUsd : -Infinity;
        }
      }
    },
    [stats]
  );

  const sortedRows = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = valueOf(a, sort.key);
      const bv = valueOf(b, sort.key);
      if (av !== bv) return sort.dir === "desc" ? bv - av : av - bv;
      // Stable tiebreak: latest activity, then address for determinism.
      if (a.latestTradeAt !== b.latestTradeAt) return b.latestTradeAt - a.latestTradeAt;
      return a.stxAddress.localeCompare(b.stxAddress);
    });
    return copy;
  }, [rows, sort, valueOf]);

  const statsReady = stats !== null;

  useEffect(() => {
    if (rows.length === 0) {
      setStats(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      // Distinct token ids across both legs (spent + received). The
      // literal `"unknown"` parser sentinel is filtered out — no point
      // burning a Tenero call on a string we know isn't a real token.
      const distinctTokenIds = Array.from(
        new Set(
          rows.flatMap((r) => [
            ...r.tokensSpent.map((t) => t.tokenId),
            ...r.tokensReceived.map((t) => t.tokenId),
          ])
        )
      ).filter((id) => id !== "unknown");

      const priced = await Promise.all(
        distinctTokenIds.map(
          async (id) => [id, await fetchTokenPrice(id)] as const
        )
      );
      const priceLookup: Record<string, TokenPrice | null> = {};
      for (const [id, entry] of priced) priceLookup[id] = entry;
      if (!cancelled) setStats(computeStats(rows, priceLookup));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

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
    <>
      {/* Sort chips — outside the table card, horizontally scrollable on mobile. */}
      <div className="mb-4 -mx-2 flex items-center gap-2 overflow-x-auto px-2 pb-1">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-white/40">
          Sort by
        </span>
        {SORT_OPTIONS.map(({ key, label }) => {
          const active = sort.key === key;
          const disabled = STATS_DEPENDENT_KEYS.has(key) && !statsReady;
          return (
            <button
              key={key}
              type="button"
              onClick={() => cycleSort(key)}
              disabled={disabled}
              title={
                disabled
                  ? "Loading prices…"
                  : active
                    ? "Click to flip direction"
                    : `Sort by ${label}`
              }
              className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-[#F7931A]/40 bg-[#F7931A]/10 text-[#F7931A]"
                  : "border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white"
              } ${disabled ? "cursor-not-allowed opacity-40 hover:border-white/[0.08] hover:text-white/60" : ""}`}
            >
              <span>{label}</span>
              {active && (
                <span aria-hidden="true">{sort.dir === "desc" ? "↓" : "↑"}</span>
              )}
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
                <th scope="col" className="px-4 py-3 font-medium text-right">Trades</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Volume (USD)</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Unrealized P&amp;L (USD)</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Latest Trade</th>
              </tr>
            </thead>
          <tbody>
            {sortedRows.map((row, idx) => (
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
                <td className="px-4 py-3 text-right">
                  {renderVolumeCell(row, stats?.get(row.stxAddress))}
                </td>
                <td className="px-4 py-3 text-right">
                  {renderPnlCell(row, stats?.get(row.stxAddress))}
                </td>
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
        {sortedRows.map((row, idx) => {
          const rowStats = stats?.get(row.stxAddress);
          const volumeLabel = !rowStats
            ? "…"
            : rowStats.volumeUsd > 0
              ? `${formatUsd(rowStats.volumeUsd)}${rowStats.allPriced ? "" : "*"}`
              : "—";
          const pnlPositive = rowStats ? rowStats.pnlUsd >= 0 : false;
          // Mobile cell: percentage only (matches desktop posture); the
          // precise USD goes in the `title` so tap-and-hold or assistive
          // tooling can surface it.
          const pnlLabel = !rowStats
            ? "…"
            : rowStats.volumeUsd <= 0 || rowStats.pnlPercent == null
              ? "—"
              : `${pnlPositive ? "+" : ""}${rowStats.pnlPercent.toFixed(2)}%${rowStats.allPriced ? "" : "*"}`;
          const pnlTitle =
            !rowStats || rowStats.volumeUsd <= 0
              ? undefined
              : `${pnlPositive ? "+" : ""}${formatUsdPrecise(rowStats.pnlUsd)}${rowStats.allPriced ? "" : " (partial)"}`;
          const pnlColor =
            !rowStats || rowStats.volumeUsd <= 0
              ? "text-white/40"
              : pnlPositive
                ? "text-[#4dcd5e]"
                : "text-[#f06464]";
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
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/50">
                  <span className="text-[#F7931A]">{row.tradeCount} trades</span>
                  <span>·</span>
                  <span>{volumeLabel}</span>
                  <span>·</span>
                  {pnlTitle ? (
                    <Tooltip text={pnlTitle}>
                      <span className={`cursor-pointer ${pnlColor}`}>
                        {pnlLabel}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className={pnlColor}>{pnlLabel}</span>
                  )}
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
    </>
  );
}
