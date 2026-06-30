"use client";

import Link from "next/link";
import type { LegionSummary, RegistrySnapshot } from "@/lib/legion/types";
import { formatSbtc, shortAddress } from "@/lib/legion/format";

function KindBadge({ kind }: { kind: LegionSummary["kind"] }) {
  const isProvider = kind === "provider";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
        isProvider
          ? "bg-[#7DA2FF]/15 text-[#7DA2FF]"
          : "bg-[#F7931A]/15 text-[#F7931A]"
      }`}
    >
      {isProvider ? "Provider" : "Demand"}
    </span>
  );
}

function LegionCard({ legion }: { legion: LegionSummary }) {
  const isProvider = legion.kind === "provider";
  const countLabel = isProvider ? "providers" : "proposals";
  return (
    <Link
      href={`/legions/${legion.id}`}
      className="group flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <KindBadge kind={legion.kind} />
            {!legion.active && (
              <span className="text-[10px] uppercase tracking-[0.08em] text-white/30">
                inactive
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-white group-hover:text-[#F7931A]">
            {legion.uri || `Legion #${legion.id}`}
          </h3>
          {isProvider && legion.model && (
            <p className="font-mono text-xs text-white/50">{legion.model}</p>
          )}
        </div>
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            legion.active ? "bg-green-400" : "bg-white/20"
          }`}
          aria-hidden
        />
      </div>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
            Treasury
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-white">
            {formatSbtc(legion.treasuryBalance)}{" "}
            <span className="text-xs font-normal text-white/40">sBTC</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
            {countLabel}
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-white">
            {legion.count != null ? legion.count : "—"}
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.06] pt-3 text-[11px] text-white/40">
        Admin{" "}
        <span className="font-mono text-white/60" title={legion.owner}>
          {shortAddress(legion.owner, 6, 4)}
        </span>
      </div>
    </Link>
  );
}

export default function LegionsClient({
  registry,
}: {
  registry: RegistrySnapshot | null;
}) {
  if (!registry || registry.legions.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
          {registry
            ? "No Legions registered yet."
            : "Couldn't load the Legion registry right now — the on-chain reader is warming up. Refresh in a moment."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Header errors={registry.errors.length} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {registry.legions.map((legion) => (
          <LegionCard key={legion.id} legion={legion} />
        ))}
      </div>
    </div>
  );
}

function Header({ errors = 0 }: { errors?: number }) {
  return (
    <header className="space-y-3">
      <h1 className="text-3xl font-bold max-md:text-2xl">AIBTC Legions</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-white/60">
        On-chain agent collectives on Stacks testnet. <strong>Demand</strong>{" "}
        Legions pool sBTC into a shared treasury and govern it by stake-weighted
        voting. <strong>Provider</strong> Legions are guilds of inference
        operators — anyone joins for free, serves a model, and earns sBTC per
        call (the Legion&apos;s treasury skims 8%); an optional stake only buys
        ranking. Pick a Legion to see its live state.
      </p>
      {errors > 0 && (
        <p className="text-xs text-amber-300/70">
          Some on-chain reads failed for this snapshot ({errors}) — the list may
          be partial.
        </p>
      )}
    </header>
  );
}
