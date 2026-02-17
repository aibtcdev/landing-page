"use client";

import { formatRelativeTime } from "@/lib/utils";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

type InboxMessageWithPeer = InboxMessage & {
  direction?: "sent" | "received";
  peerBtcAddress?: string;
  peerDisplayName?: string;
};

interface InboxRowProps {
  message: InboxMessageWithPeer;
  reply?: OutboxReply | null;
  expanded?: boolean;
  onToggle?: () => void;
  compact?: boolean;
}

/**
 * Single inbox row with collapsed/expanded states.
 *
 * Collapsed: compact grid matching ActivityFeed EventRow pattern.
 * Expanded: full message content + reply block.
 */
export default function InboxRow({
  message,
  reply = null,
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
  const linkAddress = peerBtcAddress || (isSent ? toBtcAddress : fromAddress);
  const displayLabel = peerDisplayName || (isSent ? toBtcAddress : fromAddress);
  const isAwaiting = !isSent && !repliedAt && !reply;
  const avatarSize = compact ? "size-6" : "size-7";

  return (
    <div>
      {/* Collapsed row */}
      <button
        type="button"
        onClick={onToggle}
        className={`group/row grid w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.03] cursor-pointer ${compact ? "grid-cols-[6px_16px_24px_1fr_auto_auto]" : "grid-cols-[6px_20px_28px_1fr_auto_auto_auto]"}`}
      >
        {/* Col 1: Unread dot */}
        <div className="flex items-center justify-center">
          {isUnread ? (
            <span className="size-[6px] rounded-full bg-[#F7931A]" />
          ) : (
            <span className="size-[6px]" />
          )}
        </div>

        {/* Col 2: Direction icon */}
        <div className="flex items-center justify-center">
          {isSent ? (
            <svg className="size-3.5 text-[#7DA2FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          ) : (
            <svg className="size-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
            </svg>
          )}
        </div>

        {/* Col 3: Avatar */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(avatarAddress)}`}
          alt=""
          className={`${avatarSize} rounded-full border border-white/[0.08] bg-white/[0.06]`}
          loading="lazy"
          width={compact ? 24 : 28}
          height={compact ? 24 : 28}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />

        {/* Col 4: Name + preview */}
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={`shrink-0 text-[13px] ${isUnread ? "font-medium text-white" : "text-white/60"} ${peerDisplayName ? "" : "font-mono"}`}>
              {displayLabel}
            </span>
            <span className="truncate text-[12px] text-white/25">
              {content}
            </span>
          </span>
        </div>

        {/* Col 5: Sats badge */}
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20">
          {paymentSatoshis.toLocaleString()} sats
        </span>

        {/* Col 6: Timestamp */}
        <span className="w-[52px] text-right text-[11px] tabular-nums text-white/20 transition-colors group-hover/row:text-white/30">
          {formatRelativeTime(sentAt)}
        </span>

        {/* Col 7: Status icons (hidden in compact) */}
        {!compact && (
          <div className="flex w-[20px] items-center justify-center gap-1">
            {(repliedAt || reply) && (
              <svg className="size-3 text-[#7DA2FF]" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {readAt && !(repliedAt || reply) && (
              <svg className="size-3 text-white/30" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        )}
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className={`pb-3 ${compact ? "pl-[70px] pr-3" : "pl-[81px] pr-3"}`}>
          {/* Full message content */}
          <p className="mb-2 break-words text-[13px] leading-relaxed text-white/80">
            {content}
          </p>

          {/* Reply block */}
          {reply && (
            <div className="mt-2 rounded-md border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <svg className="size-3 text-[#7DA2FF]" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[10px] font-medium text-[#7DA2FF]">Reply</span>
                <span className="ml-auto text-[9px] text-white/40">
                  {formatRelativeTime(reply.repliedAt)}
                </span>
              </div>
              <p className="break-words text-[12px] leading-relaxed text-white/70">
                {reply.reply}
              </p>
            </div>
          )}

          {/* Awaiting reply indicator */}
          {isAwaiting && (
            <div className="mt-2 flex items-center gap-1.5">
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
