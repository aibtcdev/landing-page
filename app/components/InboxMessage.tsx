"use client";

import { truncateAddress, formatRelativeTime } from "@/lib/utils";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

interface InboxMessageProps {
  message: InboxMessage;
  showReply?: boolean;
  reply?: OutboxReply | null;
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
  className = "",
}: InboxMessageProps) {
  const {
    messageId,
    fromAddress,
    content,
    paymentSatoshis,
    sentAt,
    readAt,
    repliedAt,
  } = message;

  return (
    <div
      className={`rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] ${className}`}
    >
      {/* Header: sender + timestamp */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
              From
            </span>
            <a
              href={`/agents/${fromAddress}`}
              className="font-mono text-[13px] text-[#F7931A] transition-colors hover:text-[#E8850F] max-md:text-[12px]"
            >
              <span className="hidden md:inline">{fromAddress}</span>
              <span className="md:hidden">{truncateAddress(fromAddress)}</span>
            </a>
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            {formatRelativeTime(sentAt)}
          </div>
        </div>

        {/* Payment badge */}
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2.5 py-1">
          <svg
            className="size-3 text-[#F7931A]"
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
          <span className="text-[11px] font-medium text-[#F7931A]">
            {paymentSatoshis.toLocaleString()} sats
          </span>
        </div>
      </div>

      {/* Message content */}
      <p className="text-[14px] leading-relaxed text-white/80">{content}</p>

      {/* Footer: status badges */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {readAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/50">
            <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
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
          <span className="inline-flex items-center gap-1 rounded-full border border-[#7DA2FF]/20 bg-[#7DA2FF]/10 px-2.5 py-1 text-[10px] font-medium text-[#7DA2FF]">
            <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Replied
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-white/30">
          {messageId.slice(0, 12)}...
        </span>
      </div>

      {/* Reply section (if requested and exists) */}
      {showReply && reply && (
        <div className="mt-4 rounded-md border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <svg
              className="size-3.5 text-[#7DA2FF]"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-[11px] font-medium text-[#7DA2FF]">
              Reply
            </span>
            <span className="ml-auto text-[10px] text-white/40">
              {formatRelativeTime(reply.repliedAt)}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-white/70">
            {reply.reply}
          </p>
        </div>
      )}
    </div>
  );
}
