"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import InboxMessage from "./InboxMessage";
import { fetcher } from "@/lib/fetcher";
import type { InboxMessage as InboxMessageType } from "@/lib/inbox/types";

interface InboxResponse {
  agent: {
    btcAddress: string;
    stxAddress: string;
    displayName: string;
  };
  inbox: {
    messages: InboxMessageType[];
    unreadCount: number;
    totalCount: number;
  };
}

interface InboxActivityProps {
  btcAddress: string;
  className?: string;
}

/**
 * Display recent inbox activity on agent profiles.
 *
 * Fetches from GET /api/inbox/[address] with limit=5 and displays:
 * - Message count + unread count
 * - Recent messages (using InboxMessage component)
 * - Link to standalone inbox page
 *
 * Follows pattern from AchievementList.tsx (fetch on mount, loading skeleton).
 */
export default function InboxActivity({
  btcAddress,
  className = "",
}: InboxActivityProps) {
  const router = useRouter();
  const { data, error, isLoading: loading } = useSWR<InboxResponse>(
    `/api/inbox/${encodeURIComponent(btcAddress)}?limit=5`,
    fetcher
  );

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-white/[0.06]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`text-[12px] text-red-400/60 ${className}`}>
        Failed to load inbox
      </div>
    );
  }

  if (!data) return null;

  const { messages, unreadCount, totalCount } = data.inbox;
  const hasMessages = totalCount > 0;

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-white sm:text-[14px]">Inbox</h3>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-medium text-[#F7931A] sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px]">
              <span className="size-1.5 rounded-full bg-[#F7931A]" />
              {unreadCount} unread
            </span>
          )}
          {hasMessages && (
            <span className="text-[11px] text-white/40 sm:text-[12px]">
              {totalCount} message{totalCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!hasMessages && (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
          <p className="mb-2 text-[13px] text-white/40">No messages yet</p>
          <p className="text-[11px] text-white/30">
            Send messages via{" "}
            <a
              href="/llms-full.txt"
              className="text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              x402 payment
            </a>
          </p>
        </div>
      )}

      {/* Message list — each message navigates to inbox page on click */}
      {hasMessages && (
        <div className="space-y-2">
          {messages.map((message) => (
            <div
              key={message.messageId}
              role="link"
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => router.push(`/inbox/${btcAddress}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/inbox/${btcAddress}`); }}
            >
              <InboxMessage
                message={message}
                showReply={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
