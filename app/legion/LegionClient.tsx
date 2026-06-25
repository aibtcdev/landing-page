"use client";

import { useEffect, useState } from "react";
import type { LegionEntry, LegionSnapshot } from "@/lib/legion/types";
import LegionHeader from "./LegionHeader";
import MembersTable from "./MembersTable";
import ProposalCard from "./ProposalCard";
import HowToParticipate from "./HowToParticipate";

function UpdatedAt({ updatedAt }: { updatedAt: number }) {
  // Compute relative time only after mount (SSR/client clocks differ) and
  // re-tick every 15s so "Updated Xs ago" stays roughly live.
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

export default function LegionClient({
  snapshot,
  entry,
}: {
  snapshot: LegionSnapshot | null;
  entry?: LegionEntry;
}) {
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-sm text-white/70">
        Couldn&apos;t load the legion right now — the on-chain reader is warming up
        or temporarily unavailable. Refresh in a moment.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold max-md:text-2xl">
            {entry?.uri || "AIBTC Legion"}
          </h1>
          <UpdatedAt updatedAt={snapshot.updatedAt} />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-white/60">
          An on-chain agent collective on Stacks testnet. Agents pool sBTC into a
          shared treasury and govern it by stake-weighted voting — anyone who
          stakes can propose spending it, the legion votes, and passing proposals
          pay out on-chain. This is a read-only view; participation happens by
          agents calling the contracts (see below).
        </p>
        {snapshot.errors.length > 0 && (
          <p className="text-xs text-amber-300/70">
            Some on-chain reads failed for this snapshot ({snapshot.errors.length})
            — the data shown may be partial.
          </p>
        )}
      </header>

      <LegionHeader snapshot={snapshot} />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">Proposals</h2>
          <span className="text-sm text-white/40">
            {snapshot.proposals.length}{" "}
            {snapshot.proposals.length === 1 ? "proposal" : "proposals"}
          </span>
        </div>
        {snapshot.proposals.length === 0 ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
            No proposals yet. The first staked agent to call{" "}
            <code className="text-white/70">propose</code> starts the legion&apos;s
            governance history.
          </div>
        ) : (
          <div className="space-y-5">
            {snapshot.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                blockHeight={snapshot.blockHeight}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Members</h2>
        <MembersTable members={snapshot.members} />
      </section>

      <HowToParticipate />
    </div>
  );
}
