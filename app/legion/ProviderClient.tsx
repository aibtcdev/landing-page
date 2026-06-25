"use client";

import { useEffect, useState } from "react";
import type { ProviderSnapshot } from "@/lib/legion/types";
import { formatSbtc, shortAddress } from "@/lib/legion/format";
import { explorerContractUrl } from "@/lib/legion/constants";
import ProvidersTable from "./ProvidersTable";
import HowToProvide from "./HowToProvide";

function UpdatedAt({ updatedAt }: { updatedAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  let label = "live";
  if (now != null) {
    const secondsAgo = Math.max(0, Math.round((now - updatedAt) / 1000));
    label =
      secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400/80" aria-hidden />
      Updated {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-white/10 pl-4 first:border-l-0 first:pl-0">
      <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-white">
        {value}
      </div>
    </div>
  );
}

export default function ProviderClient({
  snapshot,
}: {
  snapshot: ProviderSnapshot | null;
}) {
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-sm text-white/70">
        Couldn&apos;t load this provider Legion right now — the on-chain reader is
        warming up or temporarily unavailable. Refresh in a moment.
      </div>
    );
  }

  const { entry, treasuryBalance, minBond, providers, blockHeight } = snapshot;
  const activeCount = providers.filter((p) => p.active).length;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#7DA2FF]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7DA2FF]">
              Provider
            </span>
            <h1 className="text-3xl font-bold max-md:text-2xl">
              {entry.uri || "AIBTC Provider Legion"}
            </h1>
          </div>
          <UpdatedAt updatedAt={snapshot.updatedAt} />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-white/60">
          A guild of inference operators on Stacks testnet. Each provider stakes a
          bond and serves{" "}
          <span className="font-mono text-white/80">{entry.model || "a model"}</span>
          , earning sBTC per call — the Legion&apos;s treasury skims 8%. This is a
          read-only view; operators join by calling the{" "}
          <code className="text-white/70">legion-providers</code> contract.
        </p>
        {snapshot.errors.length > 0 && (
          <p className="text-xs text-amber-300/70">
            Some on-chain reads failed for this snapshot ({snapshot.errors.length})
            — the data shown may be partial.
          </p>
        )}
      </header>

      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/[0.06] px-5 py-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-white/40">Treasury</span>
            <a
              href={explorerContractUrl(entry.treasury)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-white/70 transition-colors hover:text-[#7DA2FF]"
              title={entry.treasury}
            >
              {shortAddress(entry.treasury, 6, 14)}
            </a>
            <span className="text-white/15">·</span>
            <span className="text-white/40">Admin</span>
            <span className="font-mono text-white/70" title={entry.owner}>
              {shortAddress(entry.owner, 6, 4)}
            </span>
          </div>
          <div className="flex items-center gap-x-4">
            <span className="text-white/40">Block</span>
            <span className="font-mono text-white/70 tabular-nums">
              {blockHeight != null ? blockHeight.toLocaleString("en-US") : "—"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <Metric label="Pooled" value={`${formatSbtc(treasuryBalance)} sBTC`} />
          <Metric label="Min bond" value={`${formatSbtc(minBond)} sBTC`} />
          <Metric label="Providers" value={`${providers.length}`} />
          <Metric label="Active" value={`${activeCount}`} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">Providers</h2>
          <span className="text-sm text-white/40">
            {providers.length} {providers.length === 1 ? "provider" : "providers"}
          </span>
        </div>
        <ProvidersTable providers={providers} />
      </section>

      <HowToProvide minBond={minBond} model={entry.model} />
    </div>
  );
}
