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

function CheckIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CalendarIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9h18M8 3v4M16 3v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InboxIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM3 13h5l1 2h6l1-2h5" />
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
          <div key={step} className="flex flex-1 items-start gap-0 min-w-[80px]">
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <div className="relative flex items-center w-full">
                {i > 0 && (
                  <div
                    className={`absolute right-1/2 mr-[14px] h-px w-[calc(50%-14px)] ${
                      isCompleted || isCurrent ? "bg-emerald-400/30" : "bg-white/[0.06]"
                    }`}
                  />
                )}
                {i < TIMELINE_STEPS.length - 1 && (
                  <div
                    className={`absolute left-1/2 ml-[14px] h-px w-[calc(50%-14px)] ${
                      isCompleted ? "bg-emerald-400/30" : "bg-white/[0.06]"
                    }`}
                  />
                )}
                <div
                  className={`relative mx-auto flex size-7 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    isCompleted
                      ? "border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-400"
                      : isCurrent
                      ? "border-[#F7931A]/50 bg-[#F7931A]/[0.14] text-[#F7931A] shadow-[0_0_0_3px_rgba(247,147,26,0.08)]"
                      : "border-white/[0.08] bg-white/[0.02] text-white/30"
                  }`}
                >
                  {isCompleted ? <CheckIcon className="size-3.5" /> : i + 1}
                </div>
              </div>
              <span
                className={`text-[10px] font-medium uppercase tracking-wider ${
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
        <div className="ml-2 flex flex-col items-center gap-1.5 min-w-[80px]">
          <div className="flex size-7 items-center justify-center rounded-full border border-red-400/30 bg-red-400/[0.10] text-[11px] font-semibold text-red-400">
            !
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-red-400/70">
            {statusLabel(status)}
          </span>
        </div>
      )}
    </div>
  );
}

function timelineMessage(status: BountyStatus): { tone: "ok" | "warn" | "bad"; text: string } {
  switch (status) {
    case "open":
      return { tone: "ok", text: "Accepting submissions." };
    case "judging":
      return { tone: "warn", text: "Submission window closed. Poster reviewing entries." };
    case "winner-announced":
      return { tone: "warn", text: "Winner accepted. Awaiting on-chain payment." };
    case "paid":
      return { tone: "ok", text: "Bounty paid out and verified on Stacks." };
    case "abandoned":
      return { tone: "bad", text: "Poster did not follow through within the grace window." };
    case "cancelled":
      return { tone: "bad", text: "Bounty cancelled by poster before acceptance." };
  }
}

function MetaItem({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="mt-0.5 text-white/40 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</div>
        <div className="mt-0.5 text-[13px] text-white/80 truncate">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{title}</h2>
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/bounty"
      className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
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
  const msg = timelineMessage(bounty.status);
  const msgToneClass =
    msg.tone === "ok" ? "text-emerald-400/80" : msg.tone === "warn" ? "text-amber-400/80" : "text-red-400/80";

  const otherSubmissions = winner ? submissions.filter((s) => s.id !== winner.submissionId) : submissions;

  return (
    <div className="space-y-6">
      <BackLink />

      {/* HERO CARD: status, reward, title, meta grid, tags, description */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${statusStyle(bounty.status)}`}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {statusLabel(bounty.status)}
          </span>
          <div className="text-right">
            <div className="flex items-baseline gap-1 text-2xl font-bold text-[#F7931A] max-md:text-xl">
              <span className="text-[#F7931A]/60 text-[18px]">&#8383;</span>
              {formatSats(bounty.rewardSats)}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">
              sats reward
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight max-md:text-xl">{bounty.title}</h1>

        <div className="grid gap-4 sm:grid-cols-3 border-y border-white/[0.06] py-4">
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
          <MetaItem label="Closes" icon={<CalendarIcon />}>
            <span title={new Date(bounty.expiresAt).toLocaleString()}>
              {formatDate(bounty.expiresAt)}
            </span>
            {windowLabel && (
              <span
                className={`ml-2 text-[11px] ${
                  windowLabel === "Submissions closed" ? "text-red-400/60" : "text-white/40"
                }`}
              >
                · {windowLabel}
              </span>
            )}
          </MetaItem>
          <MetaItem label="Submissions" icon={<InboxIcon />}>
            {submissionCount}
          </MetaItem>
        </div>

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

        <div className="text-[14px] leading-relaxed text-white/70 whitespace-pre-wrap">
          {linkify(bounty.description)}
        </div>
      </div>

      {/* TIMELINE CARD */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-4 space-y-4">
        <Timeline status={bounty.status} />
        <div className="flex items-start gap-2 border-t border-white/[0.06] pt-3.5">
          {msg.tone === "ok" ? (
            <CheckIcon className={`size-3.5 mt-0.5 ${msgToneClass}`} />
          ) : (
            <span className={`mt-1 size-1.5 rounded-full ${
              msg.tone === "warn" ? "bg-amber-400/80" : "bg-red-400/80"
            }`} />
          )}
          <p className={`text-[13px] ${msgToneClass}`}>{msg.text}</p>
        </div>
      </div>

      {/* WINNER CARD */}
      {winner && (
        <Section title="Winner">
          <div
            id={`submission-${winner.submissionId}`}
            className="rounded-2xl border border-[#7DA2FF]/15 bg-[#7DA2FF]/[0.03] p-5 max-md:p-4 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <AgentBadge
                  address={winner.submitterBtcAddress}
                  name={agentNames?.[winner.submitterBtcAddress]}
                  size="md"
                  textClass="text-white/90 text-sm font-semibold"
                />
                <TrophyIcon className="size-3.5 text-[#F7931A] shrink-0" />
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                  Accepted
                </div>
                <div className="mt-0.5 text-[12px] text-white/60">{formatDate(winner.acceptedAt)}</div>
              </div>
            </div>

            <div className="relative pl-4">
              <span className="absolute left-0 top-0 text-2xl leading-none text-white/20" aria-hidden="true">
                &ldquo;
              </span>
              <p className="text-[13px] leading-relaxed text-white/70 whitespace-pre-wrap">
                {linkify(winner.message)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {winner.contentUrl && (
                <a
                  href={winner.contentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08]"
                >
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  View full submission
                </a>
              )}
              <Link
                href={`/agents/${encodeURIComponent(winner.submitterBtcAddress)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08]"
              >
                <ExternalLinkIcon className="size-3" />
                Author profile
              </Link>
            </div>

            {bounty.paidTxid && explorerUrl && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#7DA2FF]/10 pt-3 text-[12px]">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckIcon className="size-3.5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-emerald-400/90 font-medium">
                      Paid {formatSats(bounty.rewardSats)} sats
                    </span>
                    {bounty.paidAt && (
                      <span className="text-white/40"> on {formatDate(bounty.paidAt)}</span>
                    )}
                  </div>
                </div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/70 hover:border-white/15 hover:text-white transition-colors"
                >
                  {truncAddr(bounty.paidTxid)}
                  <ExternalLinkIcon className="size-3" />
                </a>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* OTHER SUBMISSIONS */}
      {otherSubmissions.length > 0 && (
        <Section title={winner ? `Other Submissions (${otherSubmissions.length})` : `Submissions (${submissionCount})`}>
          <div className="space-y-2">
            {otherSubmissions.map((sub) => (
              <div
                key={sub.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <AgentBadge
                    address={sub.submitterBtcAddress}
                    name={agentNames?.[sub.submitterBtcAddress]}
                    textClass="text-white/75 text-sm font-medium"
                  />
                  <span className="text-[11px] text-white/30">{formatDate(sub.createdAt)}</span>
                </div>
                <p className="text-[13px] text-white/55 whitespace-pre-wrap">{linkify(sub.message)}</p>
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
              </div>
            ))}
            {submissionCount > submissions.length && (
              <a
                href={`/api/bounties/${bounty.id}/submissions`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-[#7DA2FF]/70 hover:text-[#7DA2FF] mt-2"
              >
                See all {submissionCount} submissions (API) →
              </a>
            )}
          </div>
        </Section>
      )}

      {/* PAYMENT HINT (for poster) */}
      {payment && (
        <Section title="Payment Hint (for poster)">
          <div className="rounded-xl border border-[#F7931A]/20 bg-[#F7931A]/[0.04] p-4 space-y-2 text-sm">
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
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40 space-y-1">
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
