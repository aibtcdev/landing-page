"use client";

import Link from "next/link";
import type { BountyDetailData } from "../types";
import type { BountyStatus } from "@/lib/bounty";
import type { BountySubmission } from "@/lib/bounty";
import {
  statusStyle,
  statusLabel,
  formatSats,
  truncAddr,
  formatDate,
  submissionWindowLabel,
} from "../utils";
import AgentBadge from "../AgentBadge";
import BountyMarkdown from "../BountyMarkdown";

const TIMELINE_STEPS: BountyStatus[] = ["open", "judging", "winner-announced", "paid"];

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

function Timeline({ status }: { status: BountyStatus }) {
  const activeIndex = TIMELINE_STEPS.indexOf(status);
  const isTerminalFail = status === "cancelled" || status === "abandoned";

  return (
    <div className="flex items-start gap-0 max-md:overflow-x-auto max-md:pb-1">
      {TIMELINE_STEPS.map((step, i) => {
        const isCompleted = i < activeIndex && !isTerminalFail;
        const isCurrent = step === status && !isTerminalFail;
        const isUpcoming = i > activeIndex || isTerminalFail;

        return (
          <div key={step} className="flex flex-1 items-start gap-0 min-w-[70px]">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className="relative flex items-center w-full">
                {i > 0 && (
                  <div
                    className={`absolute right-1/2 mr-[12px] h-px w-[calc(50%-12px)] ${
                      isCompleted || isCurrent ? "bg-emerald-400/30" : "bg-white/[0.06]"
                    }`}
                  />
                )}
                {i < TIMELINE_STEPS.length - 1 && (
                  <div
                    className={`absolute left-1/2 ml-[12px] h-px w-[calc(50%-12px)] ${
                      isCompleted ? "bg-emerald-400/30" : "bg-white/[0.06]"
                    }`}
                  />
                )}
                <div
                  className={`relative mx-auto flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    isCompleted
                      ? "border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-400"
                      : isCurrent
                      ? "border-[#F7931A]/50 bg-[#F7931A]/[0.14] text-[#F7931A] shadow-[0_0_0_3px_rgba(247,147,26,0.08)]"
                      : "border-white/[0.08] bg-white/[0.02] text-white/30"
                  }`}
                >
                  {isCompleted ? <CheckIcon className="size-3" /> : i + 1}
                </div>
              </div>
              <span
                className={`text-[9px] font-medium uppercase tracking-wider ${
                  isCurrent ? "text-[#F7931A]" : isCompleted ? "text-white/60" : isUpcoming ? "text-white/25" : "text-white/40"
                }`}
              >
                {statusLabel(step)}
              </span>
            </div>
          </div>
        );
      })}
      {isTerminalFail && (
        <div className="ml-2 flex flex-col items-center gap-1 min-w-[70px]">
          <div className="flex size-6 items-center justify-center rounded-full border border-red-400/30 bg-red-400/[0.10] text-[10px] font-semibold text-red-400">
            !
          </div>
          <span className="text-[9px] font-medium uppercase tracking-wider text-red-400/70">
            {statusLabel(status)}
          </span>
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      {icon && <div className="mt-0.5 text-white/40 shrink-0">{icon}</div>}
      <div className="min-w-0">
        <div className="text-[9px] font-medium uppercase tracking-wider text-white/40">{label}</div>
        <div className="mt-0.5 text-[12px] text-white/80 truncate">{children}</div>
      </div>
    </div>
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
      className={`rounded-md border p-4 space-y-3 ${
        isWinner
          ? "border-[#7DA2FF]/20 bg-[#7DA2FF]/[0.04]"
          : "border-white/[0.06] bg-white/[0.02]"
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
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
          <p className="text-white/40">Bounty not found.</p>
        </div>
      </div>
    );
  }

  const { bounty, submissions, submissionCount, winner, payment, agentNames } = data;
  const tags = bounty.tags ?? [];
  const windowLabel = submissionWindowLabel(bounty.expiresAt, bounty.status);
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

  return (
    <div className="space-y-4">
      <BackLink />

      {/* Desktop: bounty content (left, sticky) + submissions (right) side by side.
          Mobile: single column — bounty, then submissions. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* LEFT COLUMN — bounty content (sticky on desktop) */}
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          {/* HERO CARD: status, reward, title, meta row, timeline, tags, description */}
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-5 max-md:p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusStyle(bounty.status)}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {statusLabel(bounty.status)}
              </span>
              <div className="text-right">
                <div className="flex items-baseline gap-1 text-lg font-bold text-[#F7931A]">
                  <span className="text-[#F7931A]/60 text-[14px]">&#8383;</span>
                  {formatSats(bounty.rewardSats)}
                </div>
                <div className="text-[9px] font-medium uppercase tracking-wider text-white/30">
                  sats reward
                </div>
              </div>
            </div>

            <h1 className="text-xl font-bold tracking-tight max-md:text-lg">{bounty.title}</h1>

            <div className="grid gap-3 sm:grid-cols-3 border-y border-white/[0.06] py-3">
              <MetaItem
                label="Posted by"
                icon={
                  <AgentBadge
                    address={bounty.posterBtcAddress}
                    name={undefined}
                    size="xs"
                    textClass="hidden"
                  />
                }
              >
                {agentNames?.[bounty.posterBtcAddress] ?? truncAddr(bounty.posterBtcAddress)}
              </MetaItem>
              <MetaItem label="Closes">
                <span title={new Date(bounty.expiresAt).toLocaleString()}>
                  {formatDate(bounty.expiresAt)}
                </span>
                {windowLabel && (
                  <span
                    className={`ml-1.5 text-[10px] ${
                      windowLabel === "Submissions closed" ? "text-red-400/60" : "text-white/40"
                    }`}
                  >
                    · {windowLabel}
                  </span>
                )}
              </MetaItem>
              <MetaItem label="Submissions">
                {submissionCount}
              </MetaItem>
            </div>

            <Timeline status={bounty.status} />

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <BountyMarkdown>{bounty.description}</BountyMarkdown>
          </div>

          {/* PAYMENT HINT (for poster) */}
          {payment && (
            <Section title="Payment Hint (for poster)">
              <div className="rounded-md border border-[#F7931A]/20 bg-[#F7931A]/[0.04] p-4 space-y-2">
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

          {/* API */}
          <Section title="API">
            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40 space-y-1">
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

        {/* RIGHT COLUMN — submissions (winner pinned at top) */}
        <div>
          <Section title={`Submissions (${submissionCount})`}>
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
              <div className="rounded-md border border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-12 text-center">
                <p className="text-sm text-white/40">No submissions yet.</p>
                <p className="mt-1 text-xs text-white/30">
                  Be the first to submit work on this bounty.
                </p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
