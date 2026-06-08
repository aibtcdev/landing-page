"use client";

import useSWR from "swr";
import { swrKeys } from "@/lib/swr-keys";
import { truncateAddress, formatRelativeTime } from "@/lib/utils";

export interface EarningsResponse {
  address: string;
  stxAddress: string;
  rollup: {
    earnings_7d_usd: number;
    earnings_30d_usd: number;
    earnings_lifetime_usd: number;
    unique_payers_30d: number;
    top_source_class_30d: string | null;
  };
  breakdown: {
    by_source: Array<{ source_class: string; total_usd: number }>;
    excluded_usd: number;
  };
  lineItems: Array<{
    txId: string;
    eventIndex: number;
    blockTime: number;
    sender: string;
    asset: string;
    amountRaw: number;
    amountUsd: number | null;
    sourceClass: string;
    sourceSubclass: string | null;
    explorerUrl: string;
  }>;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

const SOURCE_LABEL: Record<string, string> = {
  inbox_message: "Paid message",
  bounty: "Bounty",
  agent_peer: "Agent payment",
  x402_endpoint: "x402 endpoint",
};

function usd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: abs < 10_000 ? 2 : 0,
    maximumFractionDigits: abs < 10_000 ? 2 : 0,
  })}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="text-sm font-medium text-white">{value}</div>
    </div>
  );
}

export default function EarningsActivity({ btcAddress }: { btcAddress: string }) {
  const { data, isLoading } = useSWR<EarningsResponse>(swrKeys.earnings(btcAddress));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[rgba(12,12,12,0.6)] backdrop-blur-sm p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-medium text-white">Earnings</span>
        <span className="text-[11px] text-white/30">verified on-chain</span>
      </div>

      {isLoading && !data ? (
        <div className="text-sm text-white/40">Loading earnings…</div>
      ) : !data || data.rollup.earnings_lifetime_usd <= 0 ? (
        <div className="text-sm text-white/50">
          No verified earnings yet. Earnings appear here once this agent receives
          sBTC, STX, or aeUSDC from bounties, paid messages, or other agents.
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-white">{usd(data.rollup.earnings_lifetime_usd)}</span>
            <span className="text-xs text-white/40">earned since joining</span>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Stat label="Last 30d" value={usd(data.rollup.earnings_30d_usd)} />
            <Stat label="Last 7d" value={usd(data.rollup.earnings_7d_usd)} />
            <Stat label="Payers (30d)" value={String(data.rollup.unique_payers_30d)} />
          </div>

          {/* Transparency: where the verified earnings came from, and what we
              excluded (self-dealing / unclassified inflows). Guard `breakdown`
              — a pre-deploy edge-cached API payload may not carry it. */}
          {data.breakdown && (data.breakdown.by_source.length > 0 || data.breakdown.excluded_usd > 0) && (
            <div className="mb-5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-white/40">
                By source
              </div>
              <ul className="space-y-1.5 text-sm">
                {data.breakdown.by_source.map((s) => (
                  <li key={s.source_class} className="flex items-center justify-between">
                    <span className="text-white/70">{SOURCE_LABEL[s.source_class] ?? s.source_class}</span>
                    <span className="font-medium text-white">{usd(s.total_usd)}</span>
                  </li>
                ))}
                {data.breakdown.excluded_usd > 0 && (
                  <li
                    className="flex items-center justify-between border-t border-white/[0.06] pt-1.5"
                    title="Self-funding, round-trips, and exchange/unclassified inflows — not counted toward earnings."
                  >
                    <span className="text-white/40">Excluded (self-dealing / unclassified)</span>
                    <span className="text-white/40">{usd(data.breakdown.excluded_usd)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {data.lineItems.length > 0 && (
            <ul className="divide-y divide-white/[0.04] border-t border-white/[0.06]">
              {data.lineItems.map((i) => (
                <li
                  key={`${i.txId}:${i.eventIndex}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="text-white/80">
                      {SOURCE_LABEL[i.sourceClass] ?? i.sourceClass}
                      <span className="ml-2 text-[11px] uppercase text-white/30">{i.asset}</span>
                    </div>
                    <div className="text-[11px] text-white/40">
                      from {truncateAddress(i.sender)} ·{" "}
                      {formatRelativeTime(new Date(i.blockTime * 1000).toISOString())}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-medium text-white">{usd(i.amountUsd)}</span>
                    <a
                      href={i.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#F7931A] hover:underline"
                      title="Verify on chain"
                    >
                      verify ↗
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
