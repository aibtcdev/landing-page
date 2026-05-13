"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime } from "@/lib/utils";

/**
 * Multi-key sort state. The order of entries is the sort priority — the
 * first clause is primary, the rest are tiebreakers. Click a column
 * header to add/cycle/remove its clause:
 *   off  → click → desc (appended at lowest priority)
 *   desc → click → asc  (same position)
 *   asc  → click → off  (removed from chain)
 *
 * Reset returns the chain to `[{ key: "trades", dir: "desc" }]`, which
 * matches the server-side initial sort in `app/leaderboard/page.tsx` so
 * the first render and the reset state look identical.
 */
type SortKey = "trades" | "volume" | "pnl" | "latest";
type SortDir = "asc" | "desc";
interface SortClause {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: readonly SortClause[] = [{ key: "trades", dir: "desc" }];

const SORT_KEY_LABELS: Record<SortKey, string> = {
  trades: "Trades",
  volume: "Volume",
  pnl: "P&L",
  latest: "Latest",
};

/**
 * Columns whose values come from `stats` (the client-side Tenero compute)
 * rather than the server-rendered row. We disable toggling them until
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
    const res = await fetch(
      `${TENERO_API_BASE}/tokens/${encodeURIComponent(addr)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      writeCachedPrice(tokenId, null, null);
      return null;
    }
    const body = (await res.json()) as {
      data?: {
        price_usd?: number | string | null;
        decimals?: number | string | null;
      };
    };
    const rawPrice = body.data?.price_usd;
    const parsedPrice =
      typeof rawPrice === "string" ? parseFloat(rawPrice) : rawPrice;
    const priceUsd =
      typeof parsedPrice === "number" &&
      Number.isFinite(parsedPrice) &&
      parsedPrice > 0
        ? parsedPrice
        : null;

    const rawDecimals = body.data?.decimals;
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
  const fractionDigits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
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
  // like `-0.03%` still has the underlying magnitude (`-$0.001300`)
  // available on hover. The 2-decimal `formatUsd` truncates anything
  // smaller than a cent to `$0.00` which makes the cell look broken;
  // showing only the percentage in the cell plus full $ on hover keeps
  // both signals legible at any trade size.
  const usdDetail = `${positive ? "+" : ""}${formatUsdPrecise(stats.pnlUsd)}`;
  const title = stats.allPriced
    ? usdDetail
    : `${usdDetail} (partial — some tokens couldn't be priced and were excluded)`;

  return (
    <span className={`font-medium ${color}`} title={title}>
      {pctLabel}
      {!stats.allPriced && "*"}
    </span>
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
  const [sortKeys, setSortKeys] = useState<SortClause[]>(() => [...DEFAULT_SORT]);

  /**
   * Cycle a column through off → desc → asc → off. Position in the chain
   * is decided by activation order — the first column you click is
   * primary, subsequent clicks append as tiebreakers. Means a user who
   * wants "P&L desc, then Volume desc" just clicks P&L then Volume.
   */
  const toggleSort = useCallback((key: SortKey) => {
    setSortKeys((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx === -1) return [...prev, { key, dir: "desc" }];
      const cur = prev[idx];
      if (cur.dir === "desc") {
        const next = prev.slice();
        next[idx] = { key, dir: "asc" };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const resetSort = useCallback(() => setSortKeys([...DEFAULT_SORT]), []);

  /**
   * Treat missing stats as `-Infinity` so unpriced rows fall to the bottom
   * of any `desc` sort (and to the top of `asc`, which is the expected
   * "show me the worst/missing data" intent). For P&L we also require
   * volume > 0 — a row with no priced legs has `pnlUsd = 0` mathematically
   * but isn't actually "neutral," it's "unknown."
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
    if (sortKeys.length === 0) return rows;
    const copy = rows.slice();
    copy.sort((a, b) => {
      for (const { key, dir } of sortKeys) {
        const av = valueOf(a, key);
        const bv = valueOf(b, key);
        if (av !== bv) return dir === "desc" ? bv - av : av - bv;
      }
      return 0;
    });
    return copy;
  }, [rows, sortKeys, valueOf]);

  const sortLookup = useMemo(() => {
    const m = new Map<SortKey, { clause: SortClause; position: number }>();
    sortKeys.forEach((c, i) => m.set(c.key, { clause: c, position: i + 1 }));
    return m;
  }, [sortKeys]);

  const showResetButton = useMemo(() => {
    if (sortKeys.length !== DEFAULT_SORT.length) return true;
    return sortKeys.some(
      (c, i) =>
        c.key !== DEFAULT_SORT[i].key || c.dir !== DEFAULT_SORT[i].dir
    );
  }, [sortKeys]);

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

  /**
   * Header button: shows direction arrow + priority number (only when 2+
   * clauses are active, so single-sort stays visually clean). Disabled
   * for stats-dependent columns until the Tenero compute resolves.
   */
  const renderHeaderButton = (key: SortKey, label: ReactNode) => {
    const entry = sortLookup.get(key);
    const dependent = STATS_DEPENDENT_KEYS.has(key);
    const disabled = dependent && !statsReady;
    const showPosition = sortKeys.length > 1 && entry !== undefined;
    const dirArrow =
      entry?.clause.dir === "asc" ? "↑" : entry?.clause.dir === "desc" ? "↓" : null;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        disabled={disabled}
        aria-sort={
          entry?.clause.dir === "asc"
            ? "ascending"
            : entry?.clause.dir === "desc"
              ? "descending"
              : "none"
        }
        title={
          disabled
            ? "Loading prices… sort available once volume/P&L resolve"
            : entry
              ? `Sort priority ${entry.position} — click to flip or remove`
              : "Click to sort by this column"
        }
        className={`inline-flex items-center gap-1 font-medium uppercase tracking-wide transition-colors ${
          disabled
            ? "cursor-not-allowed text-white/20"
            : entry
              ? "text-white"
              : "text-white/40 hover:text-white/70"
        }`}
      >
        <span>{label}</span>
        {dirArrow && <span aria-hidden="true">{dirArrow}</span>}
        {showPosition && (
          <span className="text-[10px] font-mono text-white/60">
            {entry.position}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {showResetButton && (
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2 text-[11px]">
          <span className="text-white/40">
            Custom sort active —{" "}
            {sortKeys.length === 0
              ? "no clauses"
              : sortKeys
                  .map(
                    (c, i) =>
                      `${i + 1}. ${SORT_KEY_LABELS[c.key]} ${c.dir === "desc" ? "↓" : "↑"}`
                  )
                  .join("  ")}
          </span>
          <button
            type="button"
            onClick={resetSort}
            className="text-[#F7931A] hover:underline"
          >
            Reset to default
          </button>
        </div>
      )}

      {/* Mobile sort bar (no <th> on the mobile list path) */}
      <div className="md:hidden border-b border-white/[0.06] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-white/40">Sort:</span>
          {(["trades", "volume", "pnl", "latest"] as const).map((key) => (
            <span key={key}>{renderHeaderButton(key, SORT_KEY_LABELS[key])}</span>
          ))}
        </div>
      </div>

      {/* Desktop / tablet table */}
      <div className="overflow-x-auto max-md:hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wide text-white/40">
              <th scope="col" className="px-4 py-3 font-medium">Rank</th>
              <th scope="col" className="px-4 py-3 font-medium">Agent</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                {renderHeaderButton("trades", "Trades")}
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                {renderHeaderButton("volume", "Volume (USD)")}
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                {renderHeaderButton("pnl", <>P&amp;L (USD)</>)}
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-right">
                {renderHeaderButton("latest", "Latest Trade")}
              </th>
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
                  <span className={pnlColor} title={pnlTitle}>
                    {pnlLabel}
                  </span>
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
