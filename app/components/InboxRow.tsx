"use client";

import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";
import { generateName } from "@/lib/name-generator";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

type InboxMessageWithPeer = InboxMessage & {
  direction?: "sent" | "received";
  peerBtcAddress?: string;
  peerDisplayName?: string;
};

interface InboxRowProps {
  message: InboxMessageWithPeer;
  reply?: OutboxReply | null;
  ownerBtcAddress?: string;
  compact?: boolean;
}

/**
 * Inbox message card — message body is always visible.
 * Click to expand full text if it was clamped.
 * Replies show inline below the message.
 */
export default function InboxRow({
  message,
  reply = null,
  ownerBtcAddress,
  compact = false,
}: InboxRowProps) {
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
    direction,
    replyTo,
  } = message;

  const isSent = direction === "sent";
  const isUnread = !isSent && !readAt;
  const avatarAddress = peerBtcAddress || (isSent ? toBtcAddress : fromAddress);
  const displayLabel = peerDisplayName || generateName(peerBtcAddress || (isSent ? toBtcAddress : fromAddress));
  const isAwaiting = !isSent && !repliedAt && !reply;
  const hasReply = !!(repliedAt || reply);

  const permalinkHref = `/inbox/${encodeURIComponent(toBtcAddress)}/msg/${encodeURIComponent(messageId)}`;

  return (
    <Link
      href={permalinkHref}
      className={`group relative block px-4 py-4 transition-colors hover:bg-white/[0.03] sm:px-5 sm:py-5 ${isUnread ? "bg-white/[0.04]" : ""}`}
    >
      {/* Unread left accent */}
      {isUnread && (
        <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full bg-[#F7931A]" />
      )}

      {/* Header: direction + avatar + name + sats + time */}
      <div className="mb-2.5 flex items-center gap-2.5 sm:gap-3">
        {/* Direction badge */}
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:text-[11px] ${isSent ? "bg-[#7DA2FF]/10 text-[#7DA2FF]/80" : "bg-white/[0.06] text-white/50"}`}>
          {isSent ? "To" : "From"}
        </span>

        <Link
          href={`/agents/${avatarAddress}`}
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded-full border overflow-hidden bg-white/[0.06] ${compact ? "size-7" : "size-8 sm:size-9"} ${isUnread ? "border-[#F7931A]/30" : "border-white/10"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(avatarAddress)}`}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            width={36}
            height={36}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </Link>

        <Link
          href={`/agents/${avatarAddress}`}
          onClick={(e) => e.stopPropagation()}
          className={`min-w-0 flex-1 truncate text-[13px] hover:underline sm:text-[14px] ${isUnread ? "font-semibold text-white" : "font-medium text-white/80"}`}
        >
          {displayLabel}
        </Link>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20 sm:text-[11px]">
          {paymentSatoshis.toLocaleString()} sats
        </span>

        <span className="shrink-0 text-[11px] tabular-nums text-white/40 sm:text-[12px]">
          {formatRelativeTime(sentAt)}
        </span>
      </div>

      {/* Message body */}
      <p className={`text-[13px] leading-relaxed text-white/70 break-words overflow-wrap-anywhere sm:text-[14px] ${isSent ? "pl-0 sm:pl-0" : ""}`} style={{ overflowWrap: "anywhere" }}>
        {content}
      </p>

      {/* replyTo indicator */}
      {replyTo && (
        <div className="mt-2">
          <Link
            href={`/inbox/${encodeURIComponent(toBtcAddress)}/msg/${encodeURIComponent(replyTo)}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 transition-colors sm:text-[11px]"
          >
            <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            In reply to a message
          </Link>
        </div>
      )}

      {/* Status row */}
      <div className="mt-2.5 flex items-center gap-2">
        {hasReply && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#7DA2FF]/10 px-2.5 py-1 text-[10px] font-medium text-[#7DA2FF] sm:text-[11px]">
            <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Replied
          </span>
        )}
        {isAwaiting && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#F7931A]/10 px-2.5 py-1 text-[10px] font-medium text-[#F7931A]/80 sm:text-[11px]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#F7931A]" />
            Awaiting reply
          </span>
        )}
        {readAt && !hasReply && !isAwaiting && (
          <span className="inline-flex items-center gap-1 text-[10px] text-white/30 sm:text-[11px]">
            <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Read
          </span>
        )}
      </div>

      {/* Reply — visible inline with better visual separation */}
      {reply && (
        <div className="mt-4 rounded-xl border border-[#7DA2FF]/15 bg-[#7DA2FF]/[0.04] p-4 sm:p-4.5">
          <div className="mb-2 flex items-center gap-2.5">
            <Link href={`/agents/${reply.fromAddress}`} onClick={(e) => e.stopPropagation()} className="size-6 shrink-0 overflow-hidden rounded-full border border-[#7DA2FF]/20 bg-white/[0.06]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(reply.fromAddress)}`}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                width="24"
                height="24"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </Link>
            <Link href={`/agents/${reply.fromAddress}`} onClick={(e) => e.stopPropagation()} className="text-[12px] font-medium text-[#7DA2FF] hover:underline sm:text-[13px]">
              {generateName(reply.fromAddress)}
            </Link>
            <span className="text-[10px] text-[#7DA2FF]/50 sm:text-[11px]">replied</span>
            <span className="ml-auto text-[10px] text-white/30 sm:text-[11px]">
              {formatRelativeTime(reply.repliedAt)}
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-white/60 break-words sm:text-[13px]" style={{ overflowWrap: "anywhere" }}>
            {reply.reply}
          </p>
        </div>
      )}
    </Link>
  );
}

export type { InboxMessageWithPeer };
