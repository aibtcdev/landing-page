"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import Link from "next/link";
import InboxList from "./InboxList";
import { fetcher } from "@/lib/fetcher";
import { generateName } from "@/lib/name-generator";
import type { InboxMessage as InboxMessageType, OutboxReply } from "@/lib/inbox/types";

const SendMessageModal = dynamic(() => import("./SendMessageModal"), {
  ssr: false,
});

interface InboxResponse {
  agent: {
    btcAddress: string;
    stxAddress: string;
    displayName: string;
  };
  inbox: {
    messages: (InboxMessageType & { direction?: "sent" | "received"; peerBtcAddress?: string; peerDisplayName?: string })[];
    replies?: Record<string, OutboxReply>;
    unreadCount: number;
    totalCount: number;
    receivedCount?: number;
    sentCount?: number;
    economics?: {
      satsReceived: number;
      satsSent: number;
      satsNet: number;
    };
  };
}

interface InboxActivityProps {
  btcAddress: string;
  stxAddress?: string;
  className?: string;
}

/**
 * Display recent inbox activity on agent profiles with threaded replies.
 *
 * Fetches from GET /api/inbox/[address] with limit=5 and displays:
 * - Message count + unread count
 * - Recent messages with inline replies (threaded view)
 * - Send message button (empty state) or link to full inbox
 */
export default function InboxActivity({
  btcAddress,
  stxAddress,
  className = "",
}: InboxActivityProps) {
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const { data, error, isLoading: loading } = useSWR<InboxResponse>(
    `/api/inbox/${encodeURIComponent(btcAddress)}?limit=5&view=all`,
    fetcher
  );

  const displayName = data?.agent?.displayName || generateName(btcAddress);
  const resolvedStxAddress = stxAddress || data?.agent?.stxAddress || "";

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

  const { messages, replies = {}, unreadCount, totalCount, receivedCount = 0, sentCount = 0 } = data.inbox;
  const hasMessages = totalCount > 0;
  const repliedCount = messages.filter((m) => m.repliedAt).length;

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-white sm:text-[14px]">Messages</h3>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-medium text-[#F7931A] sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px]">
              <span className="size-1.5 rounded-full bg-[#F7931A]" />
              {unreadCount} unread
            </span>
          )}
          {hasMessages && (
            <button
              onClick={() => setSendModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:border-[#F7931A]/30 hover:bg-[#F7931A]/10 hover:text-[#F7931A] sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px] cursor-pointer"
            >
              <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {hasMessages && (
        <div className="mb-3 flex items-center gap-3 text-[11px] text-white/40 sm:gap-4 sm:text-[12px]">
          <span>{receivedCount} received</span>
          <span>{sentCount} sent</span>
          {repliedCount > 0 && <span>{repliedCount} replied</span>}
        </div>
      )}

      {/* Economic metrics */}
      {hasMessages && data.inbox.economics && (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-2 text-center sm:px-3">
            <span className="block text-[15px] font-semibold text-[#F7931A] sm:text-[16px]">
              {data.inbox.economics.satsReceived.toLocaleString()}
            </span>
            <span className="text-[10px] text-white/40 sm:text-[11px]">sats earned</span>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-2 text-center sm:px-3">
            <span className="block text-[15px] font-semibold text-white/70 sm:text-[16px]">
              {data.inbox.economics.satsSent.toLocaleString()}
            </span>
            <span className="text-[10px] text-white/40 sm:text-[11px]">sats spent</span>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-2 text-center sm:px-3">
            <span className={`block text-[15px] font-semibold sm:text-[16px] ${data.inbox.economics.satsNet >= 0 ? "text-[#4dcd5e]" : "text-[#F7931A]"}`}>
              {data.inbox.economics.satsNet.toLocaleString()}
            </span>
            <span className="text-[10px] text-white/40 sm:text-[11px]">net sats</span>
          </div>
        </div>
      )}

      {/* Empty state — actionable send message prompt */}
      {!hasMessages && (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-8 text-center">
          <svg
            className="mx-auto mb-3 size-8 text-white/15"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="mb-1 text-[13px] text-white/40">No messages yet</p>
          <p className="mb-4 text-[11px] text-white/25">
            Be the first to start a conversation
          </p>
          <button
            onClick={() => setSendModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#F7931A] px-4 py-2 text-[12px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.98] cursor-pointer"
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Send Message
          </button>
        </div>
      )}

      {/* Message list — compact row-based with accordion */}
      {hasMessages && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02]">
          <InboxList messages={messages} replies={replies} ownerBtcAddress={btcAddress} compact maxRows={5} />
        </div>
      )}

      {/* View all link */}
      {hasMessages && totalCount > 5 && (
        <Link
          href={`/inbox/${btcAddress}`}
          className="mt-3 block w-full rounded-lg border border-white/[0.06] bg-white/[0.02] py-2 text-center text-[11px] text-white/40 transition-colors hover:border-white/[0.1] hover:text-white/60"
        >
          View all {totalCount} messages
        </Link>
      )}

      {/* Send Message Modal */}
      {sendModalOpen && (
        <SendMessageModal
          isOpen={true}
          onClose={() => setSendModalOpen(false)}
          recipientBtcAddress={btcAddress}
          recipientStxAddress={resolvedStxAddress}
          recipientDisplayName={displayName}
        />
      )}
    </div>
  );
}
