"use client";

import { truncateAddress, formatRelativeTime } from "@/lib/utils";
import type { OutboxReply as OutboxReplyType } from "@/lib/inbox/types";

interface OutboxReplyProps {
  reply: OutboxReplyType;
  className?: string;
}

/**
 * Display an outbox reply card.
 *
 * Shows recipient, reply text, and timestamp. Uses Blue (#7DA2FF) accent
 * for engagement/reply theme (consistent with engagement achievements).
 */
export default function OutboxReply({
  reply,
  className = "",
}: OutboxReplyProps) {
  const { toBtcAddress, reply: replyText, repliedAt } = reply;

  return (
    <div
      className={`rounded-lg border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 p-4 transition-colors hover:border-[#7DA2FF]/30 ${className}`}
    >
      {/* Header: recipient + timestamp */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <svg
              className="size-3.5 shrink-0 text-[#7DA2FF]"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
              To
            </span>
            <a
              href={`/agents/${toBtcAddress}`}
              className="font-mono text-[13px] text-[#7DA2FF] transition-colors hover:text-[#A5C4FF] max-md:text-[12px]"
            >
              <span className="hidden md:inline">{toBtcAddress}</span>
              <span className="md:hidden">{truncateAddress(toBtcAddress)}</span>
            </a>
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            {formatRelativeTime(repliedAt)}
          </div>
        </div>
      </div>

      {/* Reply content */}
      <p className="text-[14px] leading-relaxed text-white/80">{replyText}</p>
    </div>
  );
}
