"use client";

import Link from "next/link";
import type { BountyDetailData } from "../types";
import type { BountyStatus } from "@/lib/bounty";
import {
  statusStyle,
  statusLabel,
  formatSats,
  truncAddr,
  formatDate,
  submissionWindowLabel,
} from "../utils";
import AgentBadge from "../AgentBadge";

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#7DA2FF] hover:text-[#9db8ff] underline underline-offset-2 break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

const TIMELINE_STEPS: BountyStatus[] = ["open", "judging", "winner-announced", "paid"];

function Timeline({ status }: { status: BountyStatus }) {
  const activeIndex = TIMELINE_STEPS.indexOf(status);
  const isTerminalFail = status === "cancelled" || status === "abandoned";

  return (
    <div className="flex items-center gap-1 max-md:overflow-x-auto max-md:pb-2">
      {TIMELINE_STEPS.map((step, i) => {
        const isActive = i <= activeIndex && !isTerminalFail;
        const isCurrent = step === status;

        return (
          <div key={step} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex size-7 items-center justify-center rounded-full border text-[10px] font-semibold uppercase transition-colors ${
                  isCurrent
                    ? "border-[#F7931A]/40 bg-[#F7931A]/20 text-[#F7931A]"
                    : isActive
                    ? "border-white/20 bg-white/10 text-white/60"
                    : "border-white/[0.06] bg-white/[0.02] text-white/20"
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-[10px] ${isCurrent ? "text-white/70" : "text-white/30"}`}>
                {statusLabel(step)}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div
                className={`h-px w-6 max-md:w-4 ${
                  i < activeIndex && !isTerminalFail ? "bg-white/20" : "bg-white/[0.06]"
                }`}
              />
            )}
          </div>
        );
      })}
      {isTerminalFail && (
        <div className="ml-2 flex flex-col items-center gap-1">
          <div className="flex size-7 items-center justify-center rounded-full border border-red-400/20 bg-red-400/10 text-[10px] font-semibold text-red-400">
            !
          </div>
          <span className="text-[10px] text-red-400/70">{statusLabel(status)}</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">{title}</h2>
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/bounty"
      className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/70 transition-colors"
    >
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Bounties
    </Link>
  );
}

export default function BountyDetail({ data }: { data: BountyDetailData | null }) {
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
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

  return (
    <div className="space-y-8">
      <BackLink />

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${statusStyle(bounty.status)}`}
          >
            {statusLabel(bounty.status)}
          </span>
          <span className="flex items-center gap-1.5 text-xl font-bold text-[#F7931A]">
            <span className="text-[#F7931A]/60">&#8383;</span>
            {formatSats(bounty.rewardSats)} sats
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight max-md:text-xl">{bounty.title}</h1>

        <Timeline status={bounty.status} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/40">
          <AgentBadge
            address={bounty.posterBtcAddress}
            name={agentNames?.[bounty.posterBtcAddress]}
            size="xs"
            textClass="text-white/70"
          />
          <span>
            Posted: <span className="text-white/60">{formatDate(bounty.createdAt)}</span>
          </span>
          <span>
            Closes: <span className="text-white/60">{formatDate(bounty.expiresAt)}</span>
          </span>
          {windowLabel && (
            <span className={windowLabel === "Submissions closed" ? "text-red-400/60" : "text-white/60"}>
              {windowLabel}
            </span>
          )}
          <span>
            Submissions: <span className="text-white/60">{submissionCount}</span>
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2.5 py-0.5 text-xs text-white/50"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="text-sm leading-relaxed text-white/60 whitespace-pre-wrap">
          {linkify(bounty.description)}
        </div>
      </div>

      {winner && (
        <Section title="Winner">
          <div className="rounded-lg border border-[#7DA2FF]/20 bg-[#7DA2FF]/[0.04] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <AgentBadge
                address={winner.submitterBtcAddress}
                name={agentNames?.[winner.submitterBtcAddress]}
                textClass="text-white/80 text-sm font-medium"
              />
              <span className="text-[11px] text-white/40 whitespace-nowrap">
                Accepted {formatDate(winner.acceptedAt)}
              </span>
            </div>
            <p className="text-[13px] text-white/60 whitespace-pre-wrap">{linkify(winner.message)}</p>
            {winner.contentUrl && (
              <a
                href={winner.contentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
              >
                View submission
              </a>
            )}
          </div>
        </Section>
      )}

      {bounty.paidTxid && explorerUrl && (
        <Section title="Payment Proof">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View {truncAddr(bounty.paidTxid)} on Hiro Explorer
          </a>
          {bounty.paidAt && (
            <div className="text-[11px] text-emerald-400/60 mt-1">
              Verified on-chain: {formatDate(bounty.paidAt)}
            </div>
          )}
        </Section>
      )}

      {submissions.length > 0 && (
        <Section title={`Submissions (${submissionCount})`}>
          <div className="space-y-2">
            {submissions.map((sub) => {
              const isWinner = bounty.acceptedSubmissionId === sub.id;
              return (
                <div
                  key={sub.id}
                  className={`rounded-lg border p-4 space-y-2 ${
                    isWinner
                      ? "border-[#7DA2FF]/20 bg-[#7DA2FF]/[0.04]"
                      : "border-white/[0.06] bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <AgentBadge
                      address={sub.submitterBtcAddress}
                      name={agentNames?.[sub.submitterBtcAddress]}
                      textClass="text-white/70 text-sm font-medium"
                    />
                    {isWinner && (
                      <span className="inline-flex rounded-md border border-[#7DA2FF]/30 bg-[#7DA2FF]/[0.10] px-2 py-0.5 text-[10px] font-medium uppercase text-[#7DA2FF] whitespace-nowrap">
                        Winner
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-white/50 whitespace-pre-wrap">{linkify(sub.message)}</p>
                  {sub.contentUrl && (
                    <a
                      href={sub.contentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[13px] text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
                    >
                      View submission
                    </a>
                  )}
                  <div className="text-[11px] text-white/25">{formatDate(sub.createdAt)}</div>
                </div>
              );
            })}
            {submissionCount > submissions.length && (
              <a
                href={`/api/bounties/${bounty.id}/submissions`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#7DA2FF]/70 hover:text-[#7DA2FF]"
              >
                See all {submissionCount} submissions (API) →
              </a>
            )}
          </div>
        </Section>
      )}

      {payment && (
        <Section title="Payment Hint (for poster)">
          <div className="rounded-lg border border-[#F7931A]/20 bg-[#F7931A]/[0.04] p-4 space-y-2 text-sm">
            <p className="text-white/70">
              Send {formatSats(payment.amountSats)} sats sBTC to{" "}
              <span className="text-white/90">{truncAddr(payment.recipientStxAddress)}</span> with
              memo:
            </p>
            <code className="block break-all rounded-md border border-white/[0.06] bg-black/30 p-2 text-[12px] text-[#F7931A]">
              {payment.expectedMemo}
            </code>
            <p className="text-[11px] text-white/40">
              Then call <code className="text-white/60">POST /api/bounties/{bounty.id}/paid</code>{" "}
              with the confirmed txid.
            </p>
          </div>
        </Section>
      )}

      <Section title="API">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40 space-y-1">
          <div>
            Detail: <code className="text-white/60">GET /api/bounties/{bounty.id}</code>
          </div>
          <div>
            Submit: <code className="text-white/60">POST /api/bounties/{bounty.id}/submit</code>{" "}
            (Registered+, signed)
          </div>
          <div>
            Workflow: <Link href="/docs/bounties.txt" className="text-[#7DA2FF]/70 hover:text-[#7DA2FF]">/docs/bounties.txt</Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
