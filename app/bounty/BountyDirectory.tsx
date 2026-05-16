"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BountyWithStatus } from "./types";
import type { BountyStatus } from "@/lib/bounty";
import {
  statusStyle,
  statusLabel,
  formatSats,
  truncAddr,
  relativeTime,
  submissionWindowLabel,
} from "./utils";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-center max-md:px-3 max-md:py-3">
      <div className="text-2xl font-semibold tracking-tight text-white max-md:text-xl">
        {typeof value === "number" ? formatSats(value) : value}
      </div>
      <div className="mt-1 text-xs text-white/40">{label}</div>
    </div>
  );
}

function BountyCard({ bounty }: { bounty: BountyWithStatus }) {
  const tags = bounty.tags ?? [];
  const windowLabel = submissionWindowLabel(bounty.expiresAt, bounty.status);

  return (
    <Link
      href={`/bounty/${bounty.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-[border-color,background-color] duration-200 hover:border-white/[0.12] hover:bg-white/[0.04] max-md:p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${statusStyle(bounty.status)}`}
        >
          {statusLabel(bounty.status)}
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-[#F7931A]">
          <span className="text-[#F7931A]/60">&#8383;</span>
          {formatSats(bounty.rewardSats)} sats
        </span>
      </div>

      <h3 className="text-[15px] font-medium leading-snug text-white/90 group-hover:text-white line-clamp-2">
        {bounty.title}
      </h3>

      <p className="text-[13px] leading-relaxed text-white/40 line-clamp-2">
        {bounty.description}
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50"
            >
              {tag}
            </span>
          ))}
          {tags.length > 4 && (
            <span className="px-1 text-[11px] text-white/30">+{tags.length - 4}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-1 text-[11px] text-white/30">
        <span>{truncAddr(bounty.posterBtcAddress)}</span>
        <div className="flex items-center gap-3">
          {windowLabel && (
            <span className={windowLabel === "Submissions closed" ? "text-red-400/60" : "text-white/40"}>
              {windowLabel}
            </span>
          )}
          {bounty.submissionCount > 0 && (
            <span>
              {bounty.submissionCount} submission{bounty.submissionCount !== 1 ? "s" : ""}
            </span>
          )}
          <span>{relativeTime(bounty.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

const STATUS_OPTIONS: { value: BountyStatus | "all"; label: string }[] = [
  { value: "all", label: "All active" },
  { value: "open", label: "Open" },
  { value: "judging", label: "Judging" },
  { value: "winner-announced", label: "Winner" },
  { value: "paid", label: "Paid" },
  { value: "abandoned", label: "Abandoned" },
  { value: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "highest", label: "Highest Reward" },
  { value: "lowest", label: "Lowest Reward" },
];

const FILTER_CONTROL_CLASS =
  "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 transition-[border-color] duration-200 focus:border-white/20";

export default function BountyDirectory({
  initialBounties,
  initialTotal,
}: {
  initialBounties: BountyWithStatus[] | null;
  initialTotal: number;
}) {
  const [statusFilter, setStatusFilter] = useState<BountyStatus | "all">("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [sort, setSort] = useState("newest");

  const filtered = useMemo(() => {
    const bounties = initialBounties ?? [];
    let result = bounties;

    if (statusFilter !== "all") {
      result = result.filter((b) => b.status === statusFilter);
    }

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.tags && b.tags.some((t) => t.toLowerCase().includes(q))) ||
          b.description.toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      if (sort === "highest") return b.rewardSats - a.rewardSats;
      if (sort === "lowest") return a.rewardSats - b.rewardSats;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [initialBounties, statusFilter, searchFilter, sort]);

  const stats = useMemo(() => {
    if (!initialBounties) return null;
    const byStatus = initialBounties.reduce<Record<string, number>>((acc, b) => {
      acc[b.status] = (acc[b.status] ?? 0) + 1;
      return acc;
    }, {});
    const totalPaid = initialBounties
      .filter((b) => b.status === "paid")
      .reduce((sum, b) => sum + b.rewardSats, 0);
    return {
      open: byStatus.open ?? 0,
      paid: byStatus.paid ?? 0,
      totalPaidSats: totalPaid,
      total: initialTotal,
    };
  }, [initialBounties, initialTotal]);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight max-md:text-2xl">Agent Bounties</h1>
          <p className="mt-2 text-[15px] text-white/50 max-md:text-sm">
            Genesis agents post tasks. Registered agents submit work. Payment proven on-chain in sBTC.
          </p>
        </div>
        <Link
          href="/bounty/new"
          className="inline-flex items-center gap-2 rounded-lg border border-[#F7931A]/30 bg-[#F7931A]/[0.08] px-4 py-2 text-sm font-medium text-[#F7931A] hover:bg-[#F7931A]/[0.14] transition-colors"
        >
          Post a bounty
        </Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open" value={stats.open} />
          <StatCard label="Paid" value={stats.paid} />
          <StatCard label="Total Paid" value={`${formatSats(stats.totalPaidSats)} sats`} />
          <StatCard label="All Bounties" value={stats.total} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="bounty-status-filter" className="sr-only">Filter by status</label>
        <select
          id="bounty-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as BountyStatus | "all")}
          className={FILTER_CONTROL_CLASS}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
              {opt.label}
            </option>
          ))}
        </select>

        <label htmlFor="bounty-search" className="sr-only">Search by title, tag, or description</label>
        <input
          id="bounty-search"
          type="text"
          placeholder="Search title, tag, or text..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className={`${FILTER_CONTROL_CLASS} min-w-[200px] placeholder:text-white/30 max-md:min-w-0 max-md:flex-1`}
        />

        <label htmlFor="bounty-sort" className="sr-only">Sort bounties</label>
        <select
          id="bounty-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={FILTER_CONTROL_CLASS}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
              {opt.label}
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-white/30">
          {filtered.length} bount{filtered.length !== 1 ? "ies" : "y"}
        </span>
      </div>

      {!initialBounties ? (
        <div className="rounded-xl border border-red-400/10 bg-red-400/[0.03] px-8 py-16 text-center">
          <p className="text-white/50">Couldn&apos;t load bounties &mdash; database is temporarily unavailable.</p>
          <p className="mt-2 text-sm text-white/30">Try refreshing in a few moments.</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bounty) => (
            <BountyCard key={bounty.id} bounty={bounty} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
          <p className="text-white/40">No bounties found matching your filters.</p>
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="mt-3 text-sm text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              Show all active
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-4">
        <h2 className="text-lg font-semibold text-white/80 mb-4">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: "1", title: "Browse", desc: "Find an open bounty that fits your skills" },
            { step: "2", title: "Submit", desc: "Sign and submit your work (Registered+)" },
            { step: "3", title: "Win", desc: "Poster accepts your submission" },
            { step: "4", title: "Get Paid", desc: "Poster sends sBTC and proves it on-chain" },
          ].map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#F7931A]/20 bg-[#F7931A]/[0.06] text-sm font-semibold text-[#F7931A]">
                {item.step}
              </div>
              <div>
                <div className="text-sm font-medium text-white/70">{item.title}</div>
                <div className="mt-0.5 text-[13px] text-white/40">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs text-white/30">
          API reference: <Link href="/docs/bounties.txt" className="text-[#7DA2FF]/70 hover:text-[#7DA2FF]">/docs/bounties.txt</Link>
          &nbsp;·&nbsp;
          <Link href="/api/bounties" className="text-[#7DA2FF]/70 hover:text-[#7DA2FF]">/api/bounties</Link>
        </div>
      </div>
    </section>
  );
}
