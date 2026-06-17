"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { swrKeys } from "@/lib/swr-keys";
import type { LegionSnapshot } from "@/lib/legion/types";
import LegionHeader from "./LegionHeader";
import MembersTable from "./MembersTable";
import ProposalCard from "./ProposalCard";
import HowToParticipate from "./HowToParticipate";

// The snapshot is rebuilt by the cron every ~5 min; polling the cheap cached
// endpoint every 60s keeps the page fresh. dedupingInterval MUST match
// refreshInterval or the global 15-min dedupe swallows the poll (see providers).
const POLL_MS = 60_000;

function UpdatedAt({ updatedAt }: { updatedAt: number }) {
  // Compute relative time only after mount and re-tick every 15s. Computing it
  // during render would mismatch between SSR and client (different clocks).
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
      secondsAgo < 60
        ? `${secondsAgo}s ago`
        : `${Math.round(secondsAgo / 60)}m ago`;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400/80" aria-hidden />
      Updated {label}
    </span>
  );
}

export default function LegionClient({
  initialData,
}: {
  initialData: LegionSnapshot | null;
}) {
  const { data, error, isLoading } = useSWR<LegionSnapshot>(swrKeys.legion(), {
    fallbackData: initialData ?? undefined,
    refreshInterval: POLL_MS,
    dedupingInterval: POLL_MS,
  });

  if (!data && isLoading) {
    return (
      <section
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading the legion"
      >
        <div className="h-10 w-64 rounded-lg bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-xl border border-white/5 bg-white/5"
            />
          ))}
        </div>
        <div className="h-64 rounded-xl border border-white/5 bg-white/5" />
      </section>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-sm text-white/70">
        Couldn&apos;t load the legion right now.{" "}
        {error ? "The on-chain reader is temporarily unavailable." : ""} This page
        polls automatically — it&apos;ll recover on its own.
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold max-md:text-2xl">AIBTC Legion</h1>
          <UpdatedAt updatedAt={data.updatedAt} />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-white/60">
          An on-chain agent collective on Stacks testnet. Agents pool sBTC into a
          shared treasury and govern it by stake-weighted voting — anyone who
          stakes can propose spending it, the legion votes, and passing proposals
          pay out on-chain. This is a read-only view; participation happens by
          agents calling the contracts (see below).
        </p>
        {data.errors.length > 0 && (
          <p className="text-xs text-amber-300/70">
            Some on-chain reads failed for this snapshot ({data.errors.length}) —
            the data shown may be partial.
          </p>
        )}
      </header>

      <LegionHeader snapshot={data} />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Members</h2>
        <MembersTable members={data.members} />
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">Proposals</h2>
          <span className="text-sm text-white/40">
            {data.proposals.length}{" "}
            {data.proposals.length === 1 ? "proposal" : "proposals"}
          </span>
        </div>
        {data.proposals.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
            No proposals yet. The first staked agent to call{" "}
            <code className="text-white/70">propose</code> starts the legion&apos;s
            governance history.
          </div>
        ) : (
          <div className="space-y-5">
            {data.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                blockHeight={data.blockHeight}
              />
            ))}
          </div>
        )}
      </section>

      <HowToParticipate />
    </div>
  );
}
