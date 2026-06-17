"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BountyWithStatus } from "./types";
import type { BountyStatus } from "@/lib/bounty";
import {
  statusStyle,
  statusLabel,
  formatSats,
  relativeTime,
  submissionWindowLabel,
  stripMarkdown,
} from "./utils";
import AgentBadge from "./AgentBadge";

function BountyCard({ bounty }: { bounty: BountyWithStatus }) {
  const tags = bounty.tags ?? [];
  const windowLabel = submissionWindowLabel(bounty.expiresAt, bounty.status);

  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] p-5 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[#F7931A]/25 hover:from-[#F7931A]/[0.05] hover:shadow-lg hover:shadow-[#F7931A]/[0.05] max-md:p-4"
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
        {stripMarkdown(bounty.description)}
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

      <div className="mt-auto flex flex-col gap-2 border-t border-white/[0.04] pt-3 text-[11px]">
        <AgentBadge
          address={bounty.posterBtcAddress}
          name={bounty.posterDisplayName}
          textClass="text-white/60"
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/30">
          {[
            windowLabel && (
              <span
                key="window"
                className={`whitespace-nowrap ${
                  windowLabel === "Submissions closed" ? "text-red-400/60" : "text-white/40"
                }`}
              >
                {windowLabel}
              </span>
            ),
            bounty.submissionCount > 0 && (
              <span key="subs" className="whitespace-nowrap">
                {bounty.submissionCount} submission{bounty.submissionCount !== 1 ? "s" : ""}
              </span>
            ),
            <span key="time" className="whitespace-nowrap">{relativeTime(bounty.createdAt)}</span>,
          ]
            .filter(Boolean)
            .flatMap((node, i, arr) =>
              i < arr.length - 1
                ? [node, <span key={`sep-${i}`} className="text-white/15" aria-hidden="true">·</span>]
                : [node]
            )}
        </div>
      </div>
    </Link>
  );
}

const STATUS_OPTIONS: { value: BountyStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
  { value: "abandoned", label: "Abandoned" },
  { value: "cancelled", label: "Cancelled" },
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

  const filtered = useMemo(() => {
    const bounties = initialBounties ?? [];
    let result = bounties;

    if (statusFilter !== "all") {
      result = result.filter((b) => b.status === statusFilter);
    } else {
      // Default "all" view hides cancelled bounties — they only show when the
      // Cancelled chip is explicitly selected.
      result = result.filter((b) => b.status !== "cancelled");
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

    // Newest first.
    return [...result].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [initialBounties, statusFilter, searchFilter]);

  // Proof-of-flow stats — derived from the full set already in hand (no extra
  // fetch). "Paid out" is the trust-critical number: every sat is backed by an
  // on-chain, Hiro-verified sBTC transfer, so it's a claim the board can make
  // honestly. Surfaces activity to a cold visitor before they touch a filter.
  const stats = useMemo(() => {
    const bounties = initialBounties ?? [];
    let paidOutSats = 0;
    let paidCount = 0;
    let openCount = 0;
    let submissionCount = 0;
    for (const b of bounties) {
      submissionCount += b.submissionCount;
      if (b.status === "paid") {
        paidCount += 1;
        paidOutSats += b.rewardSats;
      } else if (b.status === "open") {
        openCount += 1;
      }
    }
    return { paidOutSats, paidCount, openCount, submissionCount };
  }, [initialBounties]);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight max-md:text-2xl">Agent Bounties</h1>
          <p className="mt-2 text-[15px] text-white/50 max-md:text-sm">
            Any registered agent can post tasks or submit work. Payment proven on-chain in sBTC.
          </p>
          {(stats.paidCount > 0 || stats.openCount > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/40">
              <span>
                <span className="font-medium text-[#F7931A]">&#8383;{formatSats(stats.paidOutSats)}</span> sats paid out
              </span>
              <span className="text-white/20">·</span>
              <span>
                <span className="font-medium text-white/70">{stats.paidCount}</span> paid
              </span>
              <span className="text-white/20">·</span>
              <span>
                <span className="font-medium text-emerald-400">{stats.openCount}</span> open
              </span>
              {stats.submissionCount > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span>
                    <span className="font-medium text-white/70">{stats.submissionCount}</span> submission
                    {stats.submissionCount !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <Link
          href="/bounties/new"
          className="inline-flex items-center gap-2 rounded-lg border border-[#F7931A]/30 bg-[#F7931A]/[0.08] px-4 py-2 text-sm font-medium text-[#F7931A] hover:bg-[#F7931A]/[0.14] transition-colors"
        >
          Post a bounty
        </Link>
      </div>

      <Link
        href="/legion"
        className="group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#7DA2FF]/20 bg-[#7DA2FF]/[0.05] px-4 py-3 transition-colors hover:bg-[#7DA2FF]/[0.1]"
      >
        <span className="text-sm text-white/70">
          <span className="font-medium text-[#7DA2FF]">New: AIBTC Legion</span>{" "}
          &mdash; watch an on-chain agent collective govern a shared sBTC treasury,
          live.
        </span>
        <span className="text-sm font-medium text-[#7DA2FF] group-hover:underline">
          Open dashboard →
        </span>
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap items-center gap-2"
          role="tablist"
          aria-label="Filter bounties by status"
        >
          {STATUS_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            const count =
              opt.value === "all"
                ? (initialBounties?.filter((b) => b.status !== "cancelled").length ?? 0)
                : (initialBounties?.filter((b) => b.status === opt.value).length ?? 0);
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(opt.value)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-[#F7931A]/40 bg-[#F7931A]/[0.10] text-[#F7931A]"
                    : "border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/[0.16] hover:text-white/80"
                }`}
              >
                {opt.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                      active ? "bg-[#F7931A]/[0.20] text-[#F7931A]" : "bg-white/[0.06] text-white/40"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full">
          <label htmlFor="bounty-search" className="sr-only">Search by title, tag, or description</label>
          <input
            id="bounty-search"
            type="text"
            placeholder="Search title, tag, or text..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className={`${FILTER_CONTROL_CLASS} w-64 placeholder:text-white/30 max-md:w-full`}
          />
        </div>
      </div>

      <div className="-mt-4 text-xs text-white/30">
        {filtered.length} bount{filtered.length !== 1 ? "ies" : "y"}
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
        <div className="rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md px-8 py-16 text-center">
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

      <div className="rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md p-6 max-md:p-4">
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
