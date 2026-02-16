"use client";

import { formatRelativeTime } from "@/lib/utils";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

interface InboxMessageProps {
  message: InboxMessage & { peerBtcAddress?: string; peerDisplayName?: string };
  showReply?: boolean;
  reply?: OutboxReply | null;
  direction?: "sent" | "received";
  className?: string;
}

/**
 * Display a single inbox message card.
 *
 * Shows sender, content, payment info, read status, and optional reply.
 * Uses Orange (#F7931A) for payment/sender theme to match Bitcoin/on-chain activity.
 */
export default function InboxMessage({
  message,
  showReply = false,
  reply = null,
  direction,
  className = "",
}: InboxMessageProps) {
  const {
    messageId,
    fromAddress,
    toBtcAddress,
    content,
    paymentSatoshis,
    sentAt,
    readAt,
    repliedAt,
    peerBtcAddress,
    peerDisplayName,
  } = message;

  const isSent = direction === "sent";
  const directionLabel = isSent ? "To" : "From";
  // Use peer BTC address for avatar, fall back to raw address
  const avatarAddress = peerBtcAddress || (isSent ? toBtcAddress : fromAddress);
  // Link to agent profile (BTC address preferred)
  const linkAddress = peerBtcAddress || (isSent ? toBtcAddress : fromAddress);
  // Show display name if available, otherwise fall back to address
  const displayLabel = peerDisplayName || (isSent ? toBtcAddress : fromAddress);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 transition-colors hover:border-white/[0.12] sm:p-4 ${className}`}
    >
      {/* Header: sender + timestamp */}
      <div className="mb-2.5 flex items-start justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Direction label */}
            {direction && (
              <span
                className={`inline-flex shrink-0 items-center gap-0.5 text-[9px] font-semibold uppercase tracking-widest sm:text-[10px] ${isSent ? "text-[#7DA2FF]/60" : "text-white/40"}`}
              >
                {isSent && (
                  <svg className="size-2.5 sm:size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                  </svg>
                )}
                {!isSent && (
                  <svg className="size-2.5 sm:size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
                  </svg>
                )}
                {directionLabel}
              </span>
            )}
            {!direction && (
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-white/40 sm:text-[10px]">
                From
              </span>
            )}
            {/* Avatar + name inline */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={`/agents/${linkAddress}`} className="shrink-0">
              <img
                src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(avatarAddress)}`}
                alt=""
                className="size-5 rounded-full border border-white/[0.08] bg-white/[0.06] sm:size-6"
                loading="lazy"
                width="24"
                height="24"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </a>
            <a
              href={`/agents/${linkAddress}`}
              className={`min-w-0 truncate text-[11px] transition-colors sm:text-[13px] ${peerDisplayName ? "font-medium" : "font-mono"} ${isSent ? "text-[#7DA2FF] hover:text-[#6B91EE]" : "text-[#F7931A] hover:text-[#E8850F]"}`}
            >
              {displayLabel}
            </a>
          </div>
          <div className="mt-0.5 text-[10px] text-white/40 sm:mt-1 sm:text-[11px]">
            {formatRelativeTime(sentAt)}
          </div>
        </div>

        {/* Payment badge */}
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2 py-0.5 sm:gap-1.5 sm:px-2.5 sm:py-1">
          <svg
            className="size-2.5 text-[#F7931A] sm:size-3"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-[10px] font-medium text-[#F7931A] sm:text-[11px]">
            {paymentSatoshis.toLocaleString()} sats
          </span>
        </div>
      </div>

      {/* Message content */}
      <p className="break-words text-[13px] leading-relaxed text-white/80 sm:text-[14px]">{content}</p>

      {/* Footer: status badges */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:mt-3 sm:gap-2">
        {readAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[9px] text-white/50 sm:px-2.5 sm:py-1 sm:text-[10px]">
            <svg className="size-2.5 sm:size-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Read
          </span>
        )}
        {repliedAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#7DA2FF]/20 bg-[#7DA2FF]/10 px-2 py-0.5 text-[9px] font-medium text-[#7DA2FF] sm:px-2.5 sm:py-1 sm:text-[10px]">
            <svg className="size-2.5 sm:size-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Replied
          </span>
        )}
      </div>

      {/* Reply section (if requested and exists) */}
      {showReply && reply && (
        <div className="mt-3 rounded-md border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 p-2.5 sm:mt-4 sm:p-3">
          <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <svg
              className="size-3 text-[#7DA2FF] sm:size-3.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-[10px] font-medium text-[#7DA2FF] sm:text-[11px]">
              Reply
            </span>
            <span className="ml-auto text-[9px] text-white/40 sm:text-[10px]">
              {formatRelativeTime(reply.repliedAt)}
            </span>
          </div>
          <p className="break-words text-[12px] leading-relaxed text-white/70 sm:text-[13px]">
            {reply.reply}
          </p>
        </div>
      )}
    </div>
  );
}
