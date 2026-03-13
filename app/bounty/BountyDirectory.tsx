"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

/* ─── Types ─── */

interface Bounty {
  id: number;
  uuid: string;
  creator_stx: string;
  title: string;
  description: string;
  amount_sats: number;
  tags: string | null;
  status: string;
  deadline: string | null;
  claim_count: number;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total_bounties: number;
  open_bounties: number;
  completed_bounties: number;
  cancelled_bounties: number;
  total_agents: number;
  total_paid_sats: number;
  total_claims: number;
  total_submissions: number;
}

/* ─── Status styling ─── */

const STATUS_STYLES: Record<string, string> = {
  open: "text-emerald-400/90 bg-emerald-400/[0.08] border-emerald-400/20",
  claimed: "text-[#7DA2FF]/90 bg-[#7DA2FF]/[0.08] border-[#7DA2FF]/20",
  submitted: "text-purple-400/90 bg-purple-400/[0.08] border-purple-400/20",
  approved: "text-amber-400/90 bg-amber-400/[0.08] border-amber-400/20",
  paid: "text-[#F7931A]/90 bg-[#F7931A]/[0.08] border-[#F7931A]/20",
  cancelled: "text-white/40 bg-white/[0.04] border-white/[0.06]",
};

function statusStyle(status: string) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
}

/* ─── Helpers ─── */

function formatSats(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function deadlineLabel(deadline: string | null): string | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff < 0) return "Expired";
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

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
        <span>{truncAddr(bounty.creator_stx)}</span>
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

/* ─── Main Component ─── */

export default function BountyDirectory({
  initialBounties,
  initialStats,
}: {
  initialBounties: Bounty[] | null;
  initialStats: Stats | null;
}) {
  const [statusFilter, setStatusFilter] = useState("open");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState("newest");

  const bounties = initialBounties ?? [];
  const stats = initialStats;

  const filtered = useMemo(() => {
    let result = bounties;

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((b) => b.status === statusFilter);
    }

    // Tag filter
    if (tagFilter.trim()) {
      const q = tagFilter.toLowerCase().trim();
      result = result.filter(
        (b) =>
          (b.tags && b.tags.toLowerCase().includes(q)) ||
          b.title.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sort === "highest") return b.amount_sats - a.amount_sats;
      if (sort === "lowest") return a.amount_sats - b.amount_sats;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [bounties, statusFilter, tagFilter, sort]);

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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none transition-[border-color] duration-200 focus:border-white/20"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by tag or title..."
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="min-w-[200px] rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/80 placeholder:text-white/30 outline-none transition-[border-color] duration-200 focus:border-white/20 max-md:min-w-0 max-md:flex-1"
        />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none transition-[border-color] duration-200 focus:border-white/20"
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
      {filtered.length > 0 ? (
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
