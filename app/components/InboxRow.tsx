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
  expanded?: boolean;
  onToggle?: () => void;
  compact?: boolean;
}

/**
 * Single inbox row — collapsed shows a scannable summary,
 * expanded shows the full conversation thread.
 *
 * Uses flex layout for natural mobile adaptation instead of rigid CSS grid.
 */
export default function InboxRow({
  message,
  reply = null,
  ownerBtcAddress,
  expanded = false,
  onToggle,
  compact = false,
}: InboxRowProps) {
  const {
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
  } = message;

  const isSent = direction === "sent";
  const isUnread = !isSent && !readAt;
  const avatarAddress = peerBtcAddress || (isSent ? toBtcAddress : fromAddress);
  const displayLabel = peerDisplayName || generateName(peerBtcAddress || (isSent ? toBtcAddress : fromAddress));
  const isAwaiting = !isSent && !repliedAt && !reply;
  const hasReply = !!(repliedAt || reply);

  // Sender info for expanded thread
  const senderBtcAddress = isSent
    ? (ownerBtcAddress || toBtcAddress)
    : (peerBtcAddress || fromAddress);
  const senderName = isSent
    ? (ownerBtcAddress ? generateName(ownerBtcAddress) : "You")
    : (peerDisplayName || generateName(peerBtcAddress || fromAddress));

  return (
    <div>
      {/* Collapsed row */}
      <button
        type="button"
        onClick={onToggle}
        className="group/row flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.03] sm:gap-3 sm:px-4 sm:py-3 cursor-pointer"
      >
        {/* Unread dot */}
        <span className="shrink-0">
          {isUnread ? (
            <span className="block size-[6px] rounded-full bg-[#F7931A]" />
          ) : (
            <span className="block size-[6px]" />
          )}
        </span>

        {/* Direction icon */}
        <span className="shrink-0">
          {isSent ? (
            <svg className="size-3 text-[#7DA2FF] sm:size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          ) : (
            <svg className="size-3 text-white/40 sm:size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
            </svg>
          )}
        </span>

        {/* Avatar */}
        <Link
          href={`/agents/${avatarAddress}`}
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06] overflow-hidden ${compact ? "size-6" : "size-6 sm:size-7"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(avatarAddress)}`}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            width={28}
            height={28}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </Link>

        {/* Name + preview — stacks on mobile, inline on desktop */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href={`/agents/${avatarAddress}`}
              onClick={(e) => e.stopPropagation()}
              className={`shrink-0 max-w-[120px] truncate text-[12px] hover:underline sm:max-w-[180px] sm:text-[13px] ${isUnread ? "font-semibold text-white" : "text-white/60"}`}
            >
              {displayLabel}
            </Link>
            {/* Status pill inline with name — mobile + desktop */}
            {hasReply && (
              <svg className="size-2.5 shrink-0 text-[#7DA2FF] sm:size-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
            {isAwaiting && (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#F7931A]/50" />
            )}
            {/* Preview — desktop only (inline), hidden when expanded */}
            {!expanded && (
              <span className="hidden truncate text-[12px] text-white/25 sm:block">
                {content}
              </span>
            )}
          </div>
          {/* Preview — mobile only (second line), hidden when expanded */}
          {!expanded && (
            <p className="mt-0.5 truncate text-[11px] text-white/25 sm:hidden">
              {content}
            </p>
          )}
        </div>

        {/* Sats badge — pill on desktop, compact on mobile; hidden when expanded */}
        {!expanded && (
          <>
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20 sm:inline-flex">
              {paymentSatoshis.toLocaleString()} sats
            </span>
            <span className="shrink-0 text-[10px] font-bold tabular-nums text-[#F7931A]/60 sm:hidden">
              {paymentSatoshis}s
            </span>
          </>
        )}

        {/* Timestamp */}
        <span className="shrink-0 text-[10px] tabular-nums text-white/20 transition-colors group-hover/row:text-white/30 sm:w-[52px] sm:text-right sm:text-[11px]">
          {formatRelativeTime(sentAt)}
        </span>
      </button>

      {/* Expanded section — conversation thread */}
      {expanded && (
        <div className="space-y-2 px-3 pb-3 pl-[52px] sm:pl-[72px] sm:pr-4">
          {/* Original message with sender attribution */}
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 sm:p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Link href={`/agents/${senderBtcAddress}`} className="size-4 shrink-0 overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(senderBtcAddress)}`}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                  width="16"
                  height="16"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              </Link>
              <Link href={`/agents/${senderBtcAddress}`} className="text-[10px] font-medium text-white/70 hover:underline sm:text-[11px]">
                {senderName}
              </Link>
              <span className="ml-auto text-[9px] text-white/40 sm:text-[10px]">
                {formatRelativeTime(sentAt)}
              </span>
            </div>
            <p className="break-words text-[13px] leading-relaxed text-white/80 sm:text-[14px]">
              {content}
            </p>
            {/* Payment info in expanded view */}
            <div className="mt-2 flex items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[9px] font-bold tabular-nums text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20 sm:text-[10px]">
                {paymentSatoshis.toLocaleString()} sats
              </span>
              {readAt && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-white/30 sm:text-[10px]">
                  <svg className="size-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Read
                </span>
              )}
            </div>
          </div>

          {/* Reply with replier attribution */}
          {reply && (
            <div className="rounded-md border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 p-2.5 sm:p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Link href={`/agents/${reply.fromAddress}`} className="size-4 shrink-0 overflow-hidden rounded-full border border-[#7DA2FF]/20 bg-white/[0.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(reply.fromAddress)}`}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    width="16"
                    height="16"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                </Link>
                <Link href={`/agents/${reply.fromAddress}`} className="text-[10px] font-medium text-[#7DA2FF] hover:underline sm:text-[11px]">
                  {generateName(reply.fromAddress)}
                </Link>
                <span className="text-[9px] text-[#7DA2FF]/60 sm:text-[10px]">replied</span>
                <span className="ml-auto text-[9px] text-white/40 sm:text-[10px]">
                  {formatRelativeTime(reply.repliedAt)}
                </span>
              </div>
              <p className="break-words text-[12px] leading-relaxed text-white/70 sm:text-[13px]">
                {reply.reply}
              </p>
            </div>
          )}

          {/* Awaiting reply indicator */}
          {isAwaiting && (
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-[#F7931A]/50" />
              <span className="text-[10px] text-white/30">Awaiting reply</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { InboxMessageWithPeer };
