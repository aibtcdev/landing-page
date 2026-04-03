"use client";

import Link from "next/link";
import type { BountyData } from "../types";
import { statusStyle, formatSats, truncAddr, formatDate } from "../utils";

/* ─── Helpers ─── */

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

/* ─── Timeline ─── */

const TIMELINE_STEPS = ["open", "claimed", "submitted", "approved", "paid"];

function Timeline({ status }: { status: string }) {
  const activeIndex = TIMELINE_STEPS.indexOf(status);
  const isCancelled = status === "cancelled";

  return (
    <div className="flex items-center gap-1 max-md:overflow-x-auto max-md:pb-2">
      {TIMELINE_STEPS.map((step, i) => {
        const isActive = i <= activeIndex && !isCancelled;
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
                {step}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div
                className={`h-px w-6 max-md:w-4 ${
                  i < activeIndex && !isCancelled ? "bg-white/20" : "bg-white/[0.06]"
                }`}
              />
            )}
          </div>
        );
      })}
      {isCancelled && (
        <div className="ml-2 flex flex-col items-center gap-1">
          <div className="flex size-7 items-center justify-center rounded-full border border-red-400/20 bg-red-400/10 text-[10px] font-semibold text-red-400">
            X
          </div>
          <span className="text-[10px] text-red-400/70">cancelled</span>
        </div>
      )}
    </div>
  );
}

/* ─── Section Component ─── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">{title}</h2>
      {children}
    </div>
  );
}

/* ─── Back Link ─── */

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

/* ─── Main Component ─── */

export default function BountyDetail({ data, stxToBtc }: { data: BountyData | null; stxToBtc: Record<string, string> }) {
  if (!data || !data.bounty) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
          <p className="text-white/40">Bounty not found.</p>
        </div>
      </div>
    );
  }

  const { bounty, claims, submissions, payments } = data;
  const tags = bounty.tags ? bounty.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  return (
    <div className="space-y-8">
      <BackLink />

      {/* Bounty Header */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 max-md:p-4 space-y-5">
        {/* Status + Amount row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${statusStyle(bounty.status)}`}
          >
            {bounty.status}
          </span>
          <span className="flex items-center gap-1.5 text-xl font-bold text-[#F7931A]">
            <span className="text-[#F7931A]/60">&#8383;</span>
            {formatSats(bounty.amount_sats)} sats
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold tracking-tight max-md:text-xl">{bounty.title}</h1>

        {/* Timeline */}
        <Timeline status={bounty.status} />

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
          <span className="inline-flex items-center gap-1.5">
            Creator:
            {stxToBtc[bounty.creator_stx] && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(stxToBtc[bounty.creator_stx])}`}
                alt=""
                className="size-4 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
              />
            )}
            <span className="text-white/60">{bounty.creator_name || truncAddr(bounty.creator_stx)}</span>
          </span>
          <span>
            Posted: <span className="text-white/60">{formatDate(bounty.created_at)}</span>
          </span>
          {bounty.deadline && (
            <span>
              Deadline: <span className="text-white/60">{formatDate(bounty.deadline)}</span>
            </span>
          )}
          <span>
            Claims: <span className="text-white/60">{bounty.claim_count}</span>
          </span>
        </div>

        {/* Tags */}
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

        {/* Description */}
        <div className="text-sm leading-relaxed text-white/60 whitespace-pre-wrap">
          {linkify(bounty.description)}
        </div>
      </div>

      {/* Claims */}
      {claims.length > 0 && (
        <Section title={`Claims (${claims.length})`}>
          <div className="space-y-2">
            {claims.map((claim) => (
              <div
                key={claim.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm text-white/60">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(claim.claimer_btc)}`}
                      alt=""
                      className="size-5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
                    />
                    {claim.claimer_name || truncAddr(claim.claimer_btc)}
                    {claim.claimer_stx && !claim.claimer_name && (
                      <span className="text-white/30">({truncAddr(claim.claimer_stx)})</span>
                    )}
                  </span>
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase ${statusStyle(claim.status)}`}
                  >
                    {claim.status}
                  </span>
                </div>
                {claim.message && (
                  <p className="text-[13px] text-white/40">{claim.message}</p>
                )}
                <div className="text-[11px] text-white/25">{formatDate(claim.created_at)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Submissions */}
      {submissions.length > 0 && (
        <Section title={`Submissions (${submissions.length})`}>
          <div className="space-y-2">
            {submissions.map((sub) => (
              <div
                key={sub.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white/70">Submission #{sub.id}</span>
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase ${statusStyle(sub.status)}`}
                  >
                    {sub.status}
                  </span>
                </div>
                <p className="text-[13px] text-white/50 whitespace-pre-wrap">
                  {linkify(sub.description)}
                </p>
                {sub.proof_url && (
                  <a
                    href={sub.proof_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
                  >
                    <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    View Proof
                  </a>
                )}
                {sub.reviewer_notes && (
                  <div className="rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-[13px] text-white/40">
                    <span className="text-white/25 text-[11px]">Reviewer: </span>
                    {sub.reviewer_notes}
                  </div>
                )}
                <div className="text-[11px] text-white/25">{formatDate(sub.created_at)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Payments */}
      {payments.length > 0 && (
        <Section title={`Payments (${payments.length})`}>
          <div className="space-y-2">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-sm font-semibold text-[#F7931A]">
                    <span className="text-[#F7931A]/60">&#8383;</span>
                    {formatSats(payment.amount_sats)} sats
                  </span>
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase ${statusStyle(payment.status)}`}
                  >
                    {payment.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-white/40">
                  <span>
                    From: <span className="text-white/60">{truncAddr(payment.from_stx)}</span>
                  </span>
                  <span>
                    To: <span className="text-white/60">{truncAddr(payment.to_stx)}</span>
                  </span>
                </div>
                <a
                  href={`https://explorer.hiro.so/txid/0x${payment.tx_hash.replace(/^0x/, "")}?chain=mainnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-[#7DA2FF] hover:text-[#9db8ff] transition-colors"
                >
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Transaction
                </a>
                {payment.verified_at && (
                  <div className="text-[11px] text-emerald-400/60">
                    Verified: {formatDate(payment.verified_at)}
                  </div>
                )}
                <div className="text-[11px] text-white/25">{formatDate(payment.created_at)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
