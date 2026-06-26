"use client";

import { useEffect, useState } from "react";
import type { ProviderSnapshot } from "@/lib/legion/types";
import { formatSbtc, shortAddress } from "@/lib/legion/format";
import {
  explorerAddressUrl,
  explorerContractUrl,
} from "@/lib/legion/constants";
import ProvidersTable from "./ProvidersTable";
import HowToProvide from "./HowToProvide";

const TRY_IT_HREF = "#how-to-provide";
const RISKS_HREF = "#risks";

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
  const totalJobs = providers.reduce((sum, p) => sum + p.jobsOk + p.jobsFail, 0);
  const model = entry.model || "qwen2.5-7b";
  const bondLabel = minBond != null ? formatSbtc(minBond) : "the minimum";
  const pooledLabel = formatSbtc(treasuryBalance);
  const providerWord = providers.length === 1 ? "provider" : "providers";

  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <h1 className="max-w-4xl text-4xl font-bold leading-[1.1] tracking-tight text-white max-md:text-3xl">
          Stake {bondLabel} sBTC. Host{" "}
          <span className="text-[#7DA2FF]">{model}</span>. Earn 92% every time an
          autonomous agent pays you sBTC to run a query instead of using OpenAI.
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-white/70">
          The treasury takes 8%. Failed responses slash your bond. Live on Stacks
          testnet — {providers.length} {providerWord}, {totalJobs}{" "}
          {totalJobs === 1 ? "job" : "jobs"}, {pooledLabel} sBTC pooled. Real sBTC
          on mainnet comes after we prove agents actually pay.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={explorerContractUrl(entry.treasury)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[#7DA2FF]/40 bg-[#7DA2FF]/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7DA2FF]/20"
          >
            View treasury + provider on Hiro explorer
            <span aria-hidden>↗</span>
          </a>
        </div>
      </header>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300">
            <span aria-hidden>⚠</span> Testnet only
          </span>
          <UpdatedAt updatedAt={snapshot.updatedAt} />
        </div>
        <p className="text-sm leading-relaxed text-white/60">
          sBTC here is faucet money. Your real bond goes in only after we have 5+
          providers, visible agent payouts, and public audits. Membership = bond —
          no votes, no multisig.{" "}
          <a
            href={RISKS_HREF}
            className="text-amber-300/90 underline underline-offset-2 hover:text-amber-200"
          >
            Slashing rules
          </a>
          . Treasury address and admin are on-chain and clickable right now.
        </p>
      </div>

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
          <Metric label="Pooled" value={`${pooledLabel} sBTC`} />
          <Metric label="Min bond" value={`${bondLabel} sBTC`} />
          <Metric label="Providers" value={`${providers.length}`} />
          <Metric label="Active" value={`${activeCount}`} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">Providers</h2>
          <span className="text-sm text-white/40">
            {providers.length} {providerWord}
          </span>
        </div>
        <ProvidersTable providers={providers} />
      </section>

      <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
            Last activity
          </div>
          <div className="mt-1 text-white/70">
            {totalJobs === 0 ? "none yet (0 jobs)" : `${totalJobs} jobs settled`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
            Live treasury
          </div>
          <a
            href={explorerContractUrl(entry.treasury)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block font-mono text-white/70 transition-colors hover:text-[#7DA2FF]"
          >
            {shortAddress(entry.treasury, 6, 4)} ↗
          </a>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
            Live {providerWord}
          </div>
          {providers.length === 0 ? (
            <div className="mt-1 text-white/40">none yet</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {providers.map((p) => (
                <li key={p.address}>
                  <a
                    href={explorerAddressUrl(p.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-white/70 transition-colors hover:text-[#7DA2FF]"
                  >
                    {shortAddress(p.address, 6, 4)} ↗
                  </a>{" "}
                  <span className="text-white/50">
                    — {formatSbtc(p.bond)} bonded, {p.jobsOk}/{p.jobsFail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-sm leading-relaxed text-white/50">
        <span className="text-white/70">Example (illustrative):</span> 100 calls/day
        at 100 sats/call = 10,000 sats/day; after the 8% treasury cut you keep
        ~9,200 sats (~0.000092 sBTC). Real rates are set per call — this is just
        the shape of the math.
        <br />
        <span className="text-white/40">
          Demo clip of an agent paying this Legion — coming soon.
        </span>
      </p>

      <HowToProvide minBond={minBond} model={entry.model} />

      <section id="risks" className="scroll-mt-24 space-y-4">
        <h2 className="text-xl font-semibold">
          Risks, slashing math &amp; mainnet criteria
        </h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <dl className="divide-y divide-white/[0.06] text-sm">
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-white/80">What you put at risk</dt>
              <dd className="text-white/60">
                Only your bond ({bondLabel} sBTC of testnet faucet money today).
                It sits in the on-chain treasury contract, not with us — clickable
                above.
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-white/80">How slashing works</dt>
              <dd className="text-white/60">
                Endpoints that return errors or time out too often get slashed —
                your public <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-xs">jobs-ok</code>{" "}
                / <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-xs">jobs-fail</code>{" "}
                counter is on-chain and decides how much traffic you receive.
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-white/80">What you earn</dt>
              <dd className="text-white/60">
                92% of every settled call; the treasury keeps 8%. Paid in sBTC,
                per call, to your wallet.
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-white/80">Mainnet criteria</dt>
              <dd className="text-white/60">
                Real sBTC goes live only after 5+ providers, visible agent
                payouts, and public audits. Until then it is testnet only.
              </dd>
            </div>
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-white/80">Why it isn&apos;t a rug</dt>
              <dd className="text-white/60">
                Treasury and admin addresses are on-chain and clickable now; the
                contracts are read-only verifiable. Full mechanics:{" "}
                <a
                  href="/legion/skill.md"
                  className="text-[#7DA2FF] underline underline-offset-2 hover:text-[#7DA2FF]/80"
                >
                  legion skill doc
                </a>
                .
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-6">
        <a
          href={TRY_IT_HREF}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#7DA2FF]/40 bg-[#7DA2FF]/10 px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#7DA2FF]/20"
        >
          Try it on testnet — faucet + exact commands
        </a>
        <a
          href={RISKS_HREF}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          I&apos;m still skeptical — slashing math + mainnet timeline
        </a>
      </div>

      {snapshot.errors.length > 0 && (
        <p className="text-xs text-amber-300/70">
          Some on-chain reads failed for this snapshot ({snapshot.errors.length}) —
          the data shown may be partial.
        </p>
      )}
    </div>
  );
}
