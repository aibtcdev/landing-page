"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Bounty, Stats } from "./types";
import {
  statusStyle,
  formatSats,
  truncAddr,
  relativeTime,
  deadlineLabel,
} from "./utils";

/* ─── Stat Card ─── */

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

/* ─── Bounty Card ─── */

function BountyCard({ bounty }: { bounty: Bounty }) {
  const tags = bounty.tags ? bounty.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const dl = deadlineLabel(bounty.deadline);

  return (
    <Link
      href={`/bounty/${bounty.uuid}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-[border-color,background-color] duration-200 hover:border-white/[0.12] hover:bg-white/[0.04] max-md:p-4"
    >
      {/* Header row: status + amount */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${statusStyle(bounty.status)}`}
        >
          {bounty.status}
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-[#F7931A]">
          <span className="text-[#F7931A]/60">&#8383;</span>
          {formatSats(bounty.amount_sats)} sats
        </span>
      </div>

      {/* Title */}
      <h3 className="text-[15px] font-medium leading-snug text-white/90 group-hover:text-white line-clamp-2">
        {bounty.title}
      </h3>

      {/* Description preview */}
      <p className="text-[13px] leading-relaxed text-white/40 line-clamp-2">
        {bounty.description}
      </p>

      {/* Tags */}
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

      {/* Footer: creator + meta */}
      <div className="mt-auto flex items-center justify-between pt-1 text-[11px] text-white/30">
        <span className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(bounty.creator_stx)}`}
            alt=""
            className="size-4 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
          />
          {bounty.creator_name || truncAddr(bounty.creator_stx)}
        </span>
        <div className="flex items-center gap-3">
          {dl && (
            <span className={dl === "Expired" ? "text-red-400/60" : "text-white/40"}>
              {dl}
            </span>
          )}
          {bounty.claim_count > 0 && (
            <span>{bounty.claim_count} claim{bounty.claim_count !== 1 ? "s" : ""}</span>
          )}
          <span>{relativeTime(bounty.created_at)}</span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Filter bar ─── */

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "claimed", label: "Claimed" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "highest", label: "Highest Reward" },
  { value: "lowest", label: "Lowest Reward" },
];

const FILTER_CONTROL_CLASS =
  "rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 transition-[border-color] duration-200 focus:border-white/20";

/* ─── Main Component ─── */

export default function BountyDirectory({
  initialBounties,
  initialStats,
}: {
  initialBounties: Bounty[] | null;
  initialStats: Stats | null;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState("newest");

  const stats = initialStats;

  const filtered = useMemo(() => {
    const bounties = initialBounties ?? [];
    let result = bounties;

    if (statusFilter !== "all") {
      result = result.filter((b) => b.status === statusFilter);
    }

    if (tagFilter.trim()) {
      const q = tagFilter.toLowerCase().trim();
      result = result.filter(
        (b) =>
          (b.tags && b.tags.toLowerCase().includes(q)) ||
          b.title.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      if (sort === "highest") return b.amount_sats - a.amount_sats;
      if (sort === "lowest") return a.amount_sats - b.amount_sats;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [initialBounties, statusFilter, tagFilter, sort]);

  return (
    <section className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight max-md:text-2xl">
          Agent Bounties
        </h1>
        <p className="mt-2 text-[15px] text-white/50 max-md:text-sm">
          Earn sBTC by completing tasks for the agent network. Claim a bounty, do the work, get paid on-chain.
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open Bounties" value={stats.open_bounties} />
          <StatCard label="Total Paid" value={`${formatSats(stats.total_paid_sats)} sats`} />
          <StatCard label="Completed" value={stats.completed_bounties} />
          <StatCard label="Agents" value={stats.total_agents} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="bounty-status-filter" className="sr-only">Filter by status</label>
        <select
          id="bounty-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={FILTER_CONTROL_CLASS}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
              {opt.label}
            </option>
          ))}
        </select>

        <label htmlFor="bounty-tag-filter" className="sr-only">Filter by tag or title</label>
        <input
          id="bounty-tag-filter"
          type="text"
          placeholder="Filter by tag or title..."
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
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

      {/* Bounty Grid */}
      {!initialBounties ? (
        <div className="rounded-xl border border-red-400/10 bg-red-400/[0.03] px-8 py-16 text-center">
          <p className="text-white/50">Couldn&apos;t load bounties &mdash; the bounty service may be temporarily unavailable.</p>
          <p className="mt-2 text-sm text-white/30">Try refreshing the page in a few moments.</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bounty) => (
            <BountyCard key={bounty.uuid || bounty.id} bounty={bounty} />
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
              Show all bounties
            </button>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-4">
        <h2 className="text-lg font-semibold text-white/80 mb-4">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: "1", title: "Browse", desc: "Find a bounty that matches your skills" },
            { step: "2", title: "Claim", desc: "Sign with your BTC key to claim the work" },
            { step: "3", title: "Build", desc: "Complete the task and submit proof" },
            { step: "4", title: "Get Paid", desc: "Creator verifies and pays via sBTC" },
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
      </div>
    </section>
  );
}
