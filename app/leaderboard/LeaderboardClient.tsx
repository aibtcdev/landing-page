"use client";

import { useEffect, useMemo, useState } from "react";
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
   * Per-token breakdown of `amount_in` totals across the agent's
   * MCP-submitted swaps. Decimals are server-supplied so the client
   * doesn't need its own token-decimals table.
   */
  tokens: Array<{
    tokenId: string;
    sumAmountIn: number;
    decimals: number;
  }>;
}

const TENERO_BASE = "https://api.tenero.io/v1/stacks";

/** localStorage cache key + TTL for token prices. 5 min keeps the UI fresh without hammering Tenero. */
const PRICE_CACHE_PREFIX = "tenero-price:";
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedPrice {
  price: number | null;
  fetchedAt: number;
}

/** Strip the `::asset` suffix for Tenero; native STX passes through as the literal "stx". */
function toTeneroAddress(tokenId: string): string {
  if (tokenId === "stx") return "stx";
  const idx = tokenId.indexOf("::");
  return idx >= 0 ? tokenId.slice(0, idx) : tokenId;
}

function readCache(tokenId: string): CachedPrice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${PRICE_CACHE_PREFIX}${tokenId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPrice;
    if (Date.now() - parsed.fetchedAt > PRICE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(tokenId: string, price: number | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${PRICE_CACHE_PREFIX}${tokenId}`,
      JSON.stringify({ price, fetchedAt: Date.now() })
    );
  } catch {
    // localStorage full / disabled — silently fall back to no cache.
  }
}

async function fetchTeneroPrice(tokenId: string, signal: AbortSignal): Promise<number | null> {
  const addr = toTeneroAddress(tokenId);
  try {
    const r = await fetch(`${TENERO_BASE}/tokens/${encodeURIComponent(addr)}`, {
      signal,
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: { price_usd?: number | string | null } };
    const raw = body.data?.price_usd;
    const price = typeof raw === "string" ? parseFloat(raw) : raw;
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? price
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolves USD prices for every distinct tokenId in the leaderboard,
 * preferring 5-min-cached values in localStorage and falling back to
 * Tenero. Returns a Map keyed by tokenId; missing entries land as null.
 */
function useTokenPrices(rows: LeaderboardRow[]): {
  prices: Map<string, number | null>;
  isLoading: boolean;
} {
  const tokenIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const t of r.tokens) set.add(t.tokenId);
    return Array.from(set).sort();
  }, [rows]);

  const [prices, setPrices] = useState<Map<string, number | null>>(() => {
    // Seed from localStorage so users with a warm cache see numbers on
    // first paint instead of "—" then flicker.
    const seed = new Map<string, number | null>();
    for (const id of tokenIds) {
      const cached = readCache(id);
      if (cached) seed.set(id, cached.price);
    }
    return seed;
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tokenIds.length === 0) return;
    const missing = tokenIds.filter((id) => !readCache(id));
    if (missing.length === 0) return;

    const controller = new AbortController();
    setIsLoading(true);

    (async () => {
      const results = await Promise.all(
        missing.map(async (id) => {
          const price = await fetchTeneroPrice(id, controller.signal);
          writeCache(id, price);
          return [id, price] as const;
        })
      );
      if (controller.signal.aborted) return;
      setPrices((prev) => {
        const next = new Map(prev);
        for (const [id, p] of results) next.set(id, p);
        return next;
      });
      setIsLoading(false);
    })();

    return () => {
      controller.abort();
    };
  }, [tokenIds]);

  return { prices, isLoading };
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

function computeRowVolumeUsd(
  row: LeaderboardRow,
  prices: Map<string, number | null>
): { volumeUsd: number; allPriced: boolean } {
  let total = 0;
  let allPriced = true;
  for (const t of row.tokens) {
    const price = prices.get(t.tokenId);
    if (price == null) {
      allPriced = false;
      continue;
    }
    total += (t.sumAmountIn / 10 ** t.decimals) * price;
  }
  return { volumeUsd: total, allPriced };
}

export default function LeaderboardClient({ rows }: { rows: LeaderboardRow[] }) {
  const { prices, isLoading } = useTokenPrices(rows);

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
            {rows.map((row, idx) => {
              const { volumeUsd, allPriced } = computeRowVolumeUsd(row, prices);
              const showPending = !allPriced && isLoading;
              return (
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
                    {showPending ? (
                      <span className="text-[13px] text-white/30">…</span>
                    ) : volumeUsd > 0 ? (
                      <span className="font-medium text-white/80">
                        {formatUsd(volumeUsd)}
                      </span>
                    ) : (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-white/50">
                    {row.latestTradeAt > 0
                      ? formatRelativeTime(new Date(row.latestTradeAt * 1000).toISOString())
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-white/[0.04]">
        {rows.map((row, idx) => {
          const { volumeUsd, allPriced } = computeRowVolumeUsd(row, prices);
          const showPending = !allPriced && isLoading;
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
                  <span>
                    {showPending
                      ? "…"
                      : volumeUsd > 0
                        ? formatUsd(volumeUsd)
                        : "—"}
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
