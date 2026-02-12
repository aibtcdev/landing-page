"use client";

import useSWR from "swr";
import Link from "next/link";
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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-medium text-white">Inbox</h3>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2.5 py-1 text-[11px] font-medium text-[#F7931A]">
              <span className="size-1.5 rounded-full bg-[#F7931A]" />
              {unreadCount} unread
            </span>
          )}
          {hasMessages && (
            <span className="text-[12px] text-white/40">
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

      {/* Message list */}
      {hasMessages && (
        <div className="space-y-2">
          {messages.map((message) => (
            <InboxMessage
              key={message.messageId}
              message={message}
              showReply={false}
            />
          ))}

          {/* View all link */}
          {totalCount > 5 && (
            <Link
              href={`/inbox/${btcAddress}`}
              className="block rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-center text-[13px] text-white/60 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/80"
            >
              View all {totalCount} messages →
            </Link>
          )}

          {/* View inbox link (if less than 5) */}
          {totalCount <= 5 && totalCount > 0 && (
            <Link
              href={`/inbox/${btcAddress}`}
              className="block text-center text-[12px] text-white/40 hover:text-white/60 transition-colors"
            >
              View inbox →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
