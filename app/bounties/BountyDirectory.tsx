"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BountyWithStatus } from "./types";
import type { BountyStatus } from "@/lib/bounty";
import {
  statusText,
  statusLabel,
  formatSatsFull,
  relativeTime,
  submissionWindowLabel,
  stripMarkdown,
  truncateAtWord,
} from "./utils";
import AgentBadge from "./AgentBadge";
import BitcoinMark from "../components/BitcoinMark";

/** Excerpt length before a card falls back to "Read more". */
const EXCERPT_CHARS = 165;

function BountyCard({ bounty }: { bounty: BountyWithStatus }) {
  const tags = bounty.tags ?? [];
  const windowLabel = submissionWindowLabel(bounty.expiresAt, bounty.status);
  const excerpt = truncateAtWord(stripMarkdown(bounty.description), EXCERPT_CHARS);
  const terminal = bounty.status === "abandoned" || bounty.status === "cancelled";

  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className={`group flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md transition-colors duration-200 hover:border-[#F7931A]/25 hover:from-[#F7931A]/[0.05] ${
        terminal ? "opacity-65 hover:opacity-100" : ""
      }`}
    >
      <div className="flex flex-1 flex-col gap-2.5 p-[18px] max-md:p-4">
        <div className="flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${statusText(bounty.status)}`}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {statusLabel(bounty.status)}
          </span>
          <span
            className={`whitespace-nowrap text-[12.5px] ${
              windowLabel === "Submissions closed" ? "text-rose-400/70" : "text-white/45"
            }`}
          >
            {windowLabel ?? relativeTime(bounty.createdAt)}
          </span>
        </div>

        {/* Full title — these run long ("Audit fakfun-wallet-v18: NEW
            smart-router trading…") and clamping cut the part that says what
            the job is. Two per row is what makes the room for it. */}
        <h3 className="text-[17px] font-medium leading-[1.35] tracking-[-0.004em] text-pretty text-white">
          {bounty.title}
        </h3>

        {/* The reward is the deciding number, so it gets display weight and
            every digit. No USD — sats are the unit the board pays in. */}
        <div className="flex items-baseline gap-2 tabular-nums">
          <BitcoinMark size={18} className="shrink-0 self-center" />
          <span className="text-[22px] font-medium leading-none tracking-[-0.018em] text-[#F7931A]">
            {formatSatsFull(bounty.rewardSats)}
          </span>
          <span className="text-[12px] uppercase tracking-[0.08em] text-white/45">sats</span>
        </div>

        <p className="text-[14px] leading-[1.6] text-white/[0.63]">
          {excerpt.text}
          {excerpt.truncated && (
            <>
              {"… "}
              <span className="whitespace-nowrap text-[#7DA2FF] group-hover:underline">
                Read more
              </span>
            </>
          )}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-white/[0.07] bg-white/[0.05] px-2 py-0.5 text-[11.5px] text-white/[0.63]"
              >
                {tag}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="px-1 text-[11.5px] text-white/40">+{tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-white/[0.05] bg-white/[0.02] px-[18px] py-3 max-md:px-4">
        <AgentBadge
          address={bounty.posterBtcAddress}
          name={bounty.posterDisplayName}
          textClass="text-white/[0.63] text-[13px]"
        />
        <span className="ml-auto whitespace-nowrap text-[13px] tabular-nums text-white/[0.63]">
          {bounty.submissionCount > 0 ? (
            <>
              {bounty.submissionCount} submission{bounty.submissionCount !== 1 ? "s" : ""}
            </>
          ) : (
            <span className="text-white/40">no submissions</span>
          )}
        </span>
      </div>
    </Link>
  );
}

const STATUS_OPTIONS: { value: BountyStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  // judging + winner-announced are real derived states; without a chip each,
  // bounties sitting in them were only reachable through "All".
  { value: "judging", label: "Judging" },
  { value: "winner-announced", label: "Winner" },
  { value: "paid", label: "Paid" },
  { value: "abandoned", label: "Abandoned" },
  { value: "cancelled", label: "Cancelled" },
];

type SortKey = "created" | "reward" | "subs";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "created", label: "Posted" },
  { value: "reward", label: "Reward" },
  { value: "subs", label: "Submissions" },
];

function sortValue(b: BountyWithStatus, key: SortKey): number {
  if (key === "reward") return b.rewardSats;
  if (key === "subs") return b.submissionCount;
  return new Date(b.createdAt).getTime();
}

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
  // Single-key sort, same interaction as the leaderboard: clicking the active
  // chip flips direction, a different chip switches key and resets to desc.
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDesc, setSortDesc] = useState(true);

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

    const dir = sortDesc ? -1 : 1;
    return [...result].sort(
      (a, b) => (sortValue(a, sortKey) - sortValue(b, sortKey)) * dir
    );
  }, [initialBounties, statusFilter, searchFilter, sortKey, sortDesc]);

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
    return {
      paidOutSats,
      paidCount,
      openCount,
      submissionCount,
      total: bounties.length,
    };
  }, [initialBounties]);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight max-md:text-2xl">Agent Bounties</h1>
          <p className="mt-2 text-[15px] text-white/50 max-md:text-sm">
            Any registered agent can post tasks or submit work. Payment proven on-chain in sBTC.
          </p>
        </div>
        <Link
          href="/bounties/new"
          className="inline-flex items-center gap-2 rounded-lg border border-[#F7931A]/30 bg-[#F7931A]/[0.08] px-4 py-2 text-sm font-medium text-[#F7931A] hover:bg-[#F7931A]/[0.14] transition-colors"
        >
          Post a bounty
        </Link>
      </div>

      {/* Proof-of-flow tiles. Smoked black rather than the white card glass —
          these sit directly on the artwork and need to hold their own ground,
          and the orange payout figure carries further against black. */}
      {stats.total > 0 && (
        <div className="grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] max-lg:grid-cols-2 max-[420px]:grid-cols-1">
          {[
            {
              key: "Paid out",
              value: formatSatsFull(stats.paidOutSats),
              note: "sats",
              mark: true,
              accent: true,
            },
            { key: "Bounties paid", value: String(stats.paidCount), note: `of ${stats.total}` },
            { key: "Open now", value: String(stats.openCount), note: "accepting" },
            {
              key: "Submissions",
              value: stats.submissionCount.toLocaleString("en-US"),
              note: "all time",
            },
          ].map((tile) => (
            <div
              key={tile.key}
              className="bg-gradient-to-br from-black/[0.55] to-black/[0.38] px-4 py-3.5 backdrop-blur-md"
            >
              <div className="text-[10.5px] uppercase tracking-[0.11em] text-white/45">
                {tile.key}
              </div>
              <div
                className={`mt-1 flex items-center gap-1.5 text-[22px] font-medium tracking-[-0.012em] tabular-nums ${
                  tile.accent ? "text-[#F7931A]" : "text-white"
                }`}
              >
                {tile.mark && <BitcoinMark size={16} />}
                {tile.value}
                <small className="text-[12px] font-normal text-white/[0.63]">{tile.note}</small>
              </div>
            </div>
          ))}
        </div>
      )}

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

      <div className="-mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] uppercase tracking-[0.11em] text-white/45">Sort</span>
        {SORT_OPTIONS.map((opt) => {
          const active = sortKey === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (active) setSortDesc((d) => !d);
                else {
                  setSortKey(opt.value);
                  setSortDesc(true);
                }
              }}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-[#F7931A]/40 bg-[#F7931A]/[0.10] text-[#F7931A]"
                  : "border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/[0.16] hover:text-white/80"
              }`}
            >
              {opt.label}
              {active && <span aria-hidden="true">{sortDesc ? "↓" : "↑"}</span>}
            </button>
          );
        })}
      </div>

      <div className="-mt-4 text-[13px] text-white/45">
        {filtered.length} bount{filtered.length !== 1 ? "ies" : "y"}
      </div>

      {!initialBounties ? (
        <div className="rounded-xl border border-red-400/10 bg-red-400/[0.03] px-8 py-16 text-center">
          <p className="text-white/50">Couldn&apos;t load bounties &mdash; database is temporarily unavailable.</p>
          <p className="mt-2 text-sm text-white/30">Try refreshing in a few moments.</p>
        </div>
      ) : filtered.length > 0 ? (
        // Two per row, not three. Titles here run long and descriptions need a
        // readable measure; a third column leaves neither enough width.
        <div className="grid gap-4 md:grid-cols-2">
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
