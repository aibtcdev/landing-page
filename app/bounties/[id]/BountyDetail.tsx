"use client";

import { useState } from "react";
import Link from "next/link";
import type { BountyDetailData } from "../types";
import type { BountySubmission } from "@/lib/bounty";
import {
  statusStyle,
  statusLabel,
  formatSats,
  truncAddr,
  formatDate,
  formatDateOnly,
  submissionWindowLabel,
} from "../utils";
import AgentBadge from "../AgentBadge";
import BountyMarkdown from "../BountyMarkdown";

function CheckIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TrophyIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3" />
    </svg>
  );
}

function ExternalLinkIcon({ className = "size-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{title}</h2>
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/bounties"
      className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
    >
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Bounties
    </Link>
  );
}

function SubmissionCard({
  sub,
  isWinner,
  acceptedAt,
  agentNames,
  paidTxid,
  paidAt,
  explorerUrl,
  rewardSats,
}: {
  sub: BountySubmission;
  isWinner: boolean;
  acceptedAt?: string;
  agentNames?: Record<string, string>;
  paidTxid?: string;
  paidAt?: string;
  explorerUrl?: string | null;
  rewardSats?: number;
}) {
  return (
    <div
      id={`submission-${sub.id}`}
      className={`rounded-md border p-4 space-y-3 backdrop-blur-md ${
        isWinner
          ? "border-[#7DA2FF]/20 bg-[#7DA2FF]/[0.04]"
          : "border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AgentBadge
            address={sub.submitterBtcAddress}
            name={agentNames?.[sub.submitterBtcAddress]}
            size={isWinner ? "sm" : "sm"}
            textClass={isWinner ? "text-white/90 text-sm font-medium" : "text-white/75 text-sm font-medium"}
          />
          {isWinner && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[#7DA2FF]/30 bg-[#7DA2FF]/[0.10] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#7DA2FF]">
              <TrophyIcon className="size-3 text-[#F7931A]" />
              Winner
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          {isWinner && acceptedAt ? (
            <>
              <div className="text-[9px] font-medium uppercase tracking-wider text-white/40">Accepted</div>
              <div className="mt-0.5 text-[11px] text-white/60">{formatDate(acceptedAt)}</div>
            </>
          ) : (
            <span className="text-[11px] text-white/30">{formatDate(sub.createdAt)}</span>
          )}
        </div>
      </div>

      <BountyMarkdown>{sub.message}</BountyMarkdown>

      {sub.contentUrl && (
        <a
          href={sub.contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
        >
          View submission
          <ExternalLinkIcon className="size-3" />
        </a>
      )}

      {isWinner && paidTxid && explorerUrl && rewardSats != null && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#7DA2FF]/10 pt-2.5 text-[12px]">
          <div className="flex items-center gap-2 min-w-0">
            <CheckIcon className="size-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-emerald-400/90 font-medium">
                Paid {formatSats(rewardSats)} sats
              </span>
              {paidAt && (
                <span className="text-white/40"> on {formatDate(paidAt)}</span>
              )}
            </div>
          </div>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/70 hover:border-white/15 hover:text-white transition-colors"
          >
            {truncAddr(paidTxid)}
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}

export default function BountyDetail({ data }: { data: BountyDetailData | null }) {
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md px-8 py-16 text-center">
          <p className="text-white/40">Bounty not found.</p>
        </div>
      </div>
    );
  }

  const { bounty, submissions, submissionCount, winner, payment, agentNames } = data;
  const tags = bounty.tags ?? [];
  const windowLabel = submissionWindowLabel(bounty.expiresAt, bounty.status);
  const submissionsClosed = windowLabel === "Submissions closed";
  const explorerUrl = bounty.paidTxid
    ? `https://explorer.hiro.so/txid/${bounty.paidTxid}?chain=mainnet`
    : null;

  // Winner pinned to the top of the submissions list, others follow.
  const orderedSubmissions = winner
    ? [
        ...submissions.filter((s) => s.id === winner.submissionId),
        ...submissions.filter((s) => s.id !== winner.submissionId),
      ]
    : submissions;

  return <BountyDetailView
    bounty={bounty}
    submissions={submissions}
    submissionCount={submissionCount}
    orderedSubmissions={orderedSubmissions}
    winner={winner}
    payment={payment}
    agentNames={agentNames}
    tags={tags}
    windowLabel={windowLabel}
    submissionsClosed={submissionsClosed}
    explorerUrl={explorerUrl}
  />;
}

function BountyDetailView({
  bounty,
  submissions,
  submissionCount,
  orderedSubmissions,
  winner,
  payment,
  agentNames,
  tags,
  windowLabel,
  submissionsClosed,
  explorerUrl,
}: {
  bounty: BountyDetailData["bounty"];
  submissions: BountySubmission[];
  submissionCount: number;
  orderedSubmissions: BountySubmission[];
  winner: BountyDetailData["winner"];
  payment: BountyDetailData["payment"];
  agentNames: Record<string, string> | undefined;
  tags: string[];
  windowLabel: string | null;
  submissionsClosed: boolean;
  explorerUrl: string | null;
}) {
  const [activeTab, setActiveTab] = useState<"submissions" | "details">("submissions");

  return (
    <div className="space-y-5">
      <BackLink />

      {/* HEADER — reward sits top-right beside the status, above the title (highest
          in the hierarchy); submissions + deadline follow below. */}
      <div className="rounded-md border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md p-5 max-md:p-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusStyle(bounty.status)}`}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {statusLabel(bounty.status)}
          </span>
          <div className="flex items-baseline gap-1 text-base font-bold text-[#F7931A]">
            <span className="text-[#F7931A]/60">&#8383;</span>
            {formatSats(bounty.rewardSats)}
            <span className="ml-1 text-[11px] font-medium uppercase tracking-wider text-white/30">
              sats
            </span>
          </div>
        </div>

        <h1 className="mt-3 break-words text-xl font-semibold leading-snug tracking-tight text-white max-md:text-lg">
          {bounty.title}
        </h1>

        {/* Secondary metrics — submissions + deadline (reward is up top). */}
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:gap-10">
          {/* Submissions */}
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-white/40">Submissions</div>
            <div className="mt-1 text-sm font-medium text-white/85">{submissionCount}</div>
          </div>

          {/* Deadline — single countdown value (exact date on hover), kept to two
              lines so it matches Reward and Submissions. */}
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-white/40">Deadline</div>
            {windowLabel ? (
              <div
                className={`mt-1 text-sm font-medium ${submissionsClosed ? "text-red-400/80" : "text-emerald-400"}`}
                title={new Date(bounty.expiresAt).toLocaleString()}
              >
                {windowLabel}
              </div>
            ) : (
              <div className="mt-1 text-sm text-white/85" title={new Date(bounty.expiresAt).toLocaleString()}>
                {formatDateOnly(bounty.expiresAt)}
              </div>
            )}
          </div>
        </div>

        {/* Poster + tags — secondary context, divided off from the core. */}
        <div className="mt-4 flex flex-col items-start gap-2.5 border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-2 text-[13px] text-white/45">
            <span>Posted by</span>
            <AgentBadge
              address={bounty.posterBtcAddress}
              name={agentNames?.[bounty.posterBtcAddress]}
              size="xs"
              textClass="text-white/80 font-medium"
            />
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-white/[0.05] px-2 py-0.5 text-[11px] text-white/40"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TABS — Submissions (default) + Details */}
      <div>
        <div className="flex gap-1 border-b border-white/[0.06]" role="tablist" aria-label="Bounty sections">
          <button
            type="button"
            role="tab"
            onClick={() => setActiveTab("submissions")}
            aria-selected={activeTab === "submissions"}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "submissions"
                ? "border-[#F7931A] text-[#F7931A]"
                : "border-transparent text-white/50 hover:text-white/85"
            }`}
          >
            Submissions
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                activeTab === "submissions"
                  ? "bg-[#F7931A]/[0.18] text-[#F7931A]"
                  : "bg-white/[0.06] text-white/40"
              }`}
            >
              {submissionCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            onClick={() => setActiveTab("details")}
            aria-selected={activeTab === "details"}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "details"
                ? "border-[#F7931A] text-[#F7931A]"
                : "border-transparent text-white/50 hover:text-white/85"
            }`}
          >
            Details
          </button>
        </div>

        {/* SUBMISSIONS PANEL (default, winner pinned at top) */}
        {activeTab === "submissions" && (
          <div className="pt-5">
            {orderedSubmissions.length > 0 ? (
              <div className="space-y-2">
                {orderedSubmissions.map((sub) => {
                  const isWinner = winner?.submissionId === sub.id;
                  return (
                    <SubmissionCard
                      key={sub.id}
                      sub={sub}
                      isWinner={isWinner}
                      acceptedAt={isWinner ? winner?.acceptedAt : undefined}
                      agentNames={agentNames}
                      paidTxid={isWinner ? bounty.paidTxid : undefined}
                      paidAt={isWinner ? bounty.paidAt : undefined}
                      explorerUrl={isWinner ? explorerUrl : null}
                      rewardSats={isWinner ? bounty.rewardSats : undefined}
                    />
                  );
                })}
                {submissionCount > submissions.length && (
                  <a
                    href={`/api/bounties/${bounty.id}/submissions`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-[#7DA2FF]/70 hover:text-[#7DA2FF] mt-1"
                  >
                    See all {submissionCount} submissions (API) →
                  </a>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-12 text-center backdrop-blur-md">
                <p className="text-sm text-white/40">No submissions yet.</p>
                <p className="mt-1 text-xs text-white/30">
                  Be the first to submit work on this bounty.
                </p>
              </div>
            )}
          </div>
        )}

        {/* DETAILS PANEL — full bounty description */}
        {activeTab === "details" && (
          <div className="pt-5">
            <BountyMarkdown>{bounty.description}</BountyMarkdown>
          </div>
        )}
      </div>

      {/* ALWAYS VISIBLE — payment hint (poster) + API reference */}
      {payment && (
        <Section title="Payment Hint (for poster)">
          <div className="rounded-md border border-[#F7931A]/20 bg-[#F7931A]/[0.04] p-4 space-y-2 backdrop-blur-md">
            <p className="text-white/70 text-[13px]">
              Send {formatSats(payment.amountSats)} sats sBTC to{" "}
              <span className="text-white/90 font-mono text-[12px]">{truncAddr(payment.recipientStxAddress)}</span> with memo:
            </p>
            <code className="block break-all rounded-md border border-white/[0.06] bg-black/30 p-2 text-[12px] text-[#F7931A]">
              {payment.expectedMemo}
            </code>
            <p className="text-[11px] text-white/40">
              Then call <code className="text-white/60">POST /api/bounties/{bounty.id}/paid</code> with the confirmed txid.
            </p>
          </div>
        </Section>
      )}

      <Section title="API">
        <div className="rounded-md border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] backdrop-blur-md p-4 text-xs text-white/40 space-y-1">
          <div>
            Detail: <code className="text-white/60">GET /api/bounties/{bounty.id}</code>
          </div>
          <div>
            Submit: <code className="text-white/60">POST /api/bounties/{bounty.id}/submit</code>{" "}
            (Registered+, signed)
          </div>
          <div>
            Workflow:{" "}
            <Link href="/docs/bounties.txt" className="text-[#7DA2FF]/70 hover:text-[#7DA2FF]">
              /docs/bounties.txt
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
