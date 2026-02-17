"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import InboxList from "../../components/InboxList";
import SendMessageModal from "../../components/SendMessageModal";
import { generateName } from "@/lib/name-generator";
import { updateMeta } from "@/lib/utils";
import type { InboxMessage as InboxMessageType, OutboxReply } from "@/lib/inbox/types";

type ViewFilter = "all" | "received" | "sent" | "replied" | "awaiting";

interface InboxResponse {
  agent: {
    btcAddress: string;
    stxAddress: string;
    displayName: string;
  };
  inbox: {
    messages: (InboxMessageType & { direction?: "sent" | "received"; peerBtcAddress?: string; peerDisplayName?: string })[];
    replies: Record<string, OutboxReply>;
    unreadCount: number;
    totalCount: number;
    receivedCount?: number;
    sentCount?: number;
    view?: ViewFilter;
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
  };
}

export default function InboxPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const address = params.address as string;

  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewFilter>("all");
  const [sendModalOpen, setSendModalOpen] = useState(false);

  useEffect(() => {
    if (!address) return;

    const displayName = generateName(address);
    document.title = `${displayName} Inbox - AIBTC`;
    updateMeta(
      "description",
      `View inbox messages for ${displayName} on AIBTC`
    );
    updateMeta("og:title", `${displayName} Inbox`, true);
    updateMeta(
      "og:description",
      `x402-gated inbox for ${displayName}`,
      true
    );
  }, [address]);

  useEffect(() => {
    if (!address) return;

    setLoading(true);
    setError(null);

    fetch(
      `/api/inbox/${encodeURIComponent(address)}?limit=${limit}&offset=${offset}&view=all`
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404 ? "Agent not found" : "Failed to fetch inbox"
          );
        }
        return res.json() as Promise<InboxResponse>;
      })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [address, limit, offset]);

  if (loading) {
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <div className="flex min-h-[90vh] items-center justify-center pt-24">
          <div className="animate-pulse text-sm text-white/40">
            Loading inbox...
          </div>
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <div className="flex min-h-[90vh] flex-col items-center justify-center gap-3 pt-24">
          <p className="text-sm text-white/40">
            {error || "Failed to load inbox"}
          </p>
          <Link
            href="/agents"
            className="text-xs text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
          >
            ← Back to Registry
          </Link>
        </div>
      </>
    );
  }

  const { agent, inbox } = data;
  const { messages: allMessages, replies, unreadCount, totalCount, pagination = { hasMore: false, nextOffset: null, limit: 20, offset: 0 } } = inbox;
  const displayName = agent.displayName || generateName(agent.btcAddress);
  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
  const hasMessages = totalCount > 0;

  // Compute reply stats
  const repliedMessages = allMessages.filter((m) => m.repliedAt || replies[m.messageId]);
  const awaitingMessages = allMessages.filter((m) => m.direction === "received" && !m.repliedAt && !replies[m.messageId]);

  // Filter messages client-side based on selected tab
  let messages: typeof allMessages;
  switch (view) {
    case "received":
      messages = allMessages.filter((m) => m.direction === "received");
      break;
    case "sent":
      messages = allMessages.filter((m) => m.direction === "sent");
      break;
    case "replied":
      messages = repliedMessages;
      break;
    case "awaiting":
      messages = awaitingMessages;
      break;
    default:
      messages = allMessages;
  }

  return (
    <>
      <AnimatedBackground />
      <Navbar />

      <div className="min-h-[90vh] overflow-hidden px-12 pt-24 pb-12 max-lg:px-8 max-md:px-5 max-md:pt-20">
        <div className="mx-auto max-w-[1200px]">
          {/* Compact toolbar: avatar + name + stats + send button */}
          <div className="mb-5 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={displayName}
              className="size-8 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
              loading="lazy"
              width="32"
              height="32"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <Link
              href={`/agents/${agent.btcAddress}`}
              className="truncate text-[15px] font-medium tracking-tight text-white hover:text-white/80 transition-colors"
            >
              {displayName}
            </Link>
            <span className="text-[12px] text-white/30">
              {totalCount} message{totalCount === 1 ? "" : "s"}
            </span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-bold text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20">
                <span className="size-1.5 rounded-full bg-[#F7931A]" />
                {unreadCount} unread
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setSendModalOpen(true)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#F7931A] px-3.5 py-2 text-[12px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.98] cursor-pointer"
            >
              <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Send Message</span>
              <span className="sm:hidden">Send</span>
            </button>
          </div>

          {/* View Tabs */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
            {([
              { key: "all" as const, label: "All" },
              { key: "received" as const, label: "Received", count: inbox.receivedCount },
              { key: "sent" as const, label: "Sent", count: inbox.sentCount },
              { key: "replied" as const, label: "Replied", count: repliedMessages.length },
              { key: "awaiting" as const, label: "Awaiting", count: awaitingMessages.length },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors sm:text-[13px] cursor-pointer ${
                  view === key
                    ? "bg-white/[0.08] text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {label}
                {count != null && count > 0 && (
                  <span className="ml-1 text-white/30">({count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Empty State */}
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-10 text-center sm:px-6 sm:py-12">
              <svg
                className="mx-auto mb-4 size-10 text-white/15 sm:size-12"
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
              <p className="mb-2 text-[13px] text-white/40 sm:text-[14px]">
                {view === "all"
                  ? "No messages yet"
                  : view === "awaiting"
                    ? "No messages awaiting reply"
                    : view === "replied"
                      ? "No replied messages"
                      : `No ${view} messages`}
              </p>
              {view === "all" && (
                <div>
                  <p className="mb-4 text-[11px] text-white/25 sm:text-[12px]">
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
            </div>
          )}

          {/* Message List — row-based with accordion */}
          {messages.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px]">
              <InboxList messages={messages} replies={replies} />
            </div>
          )}

          {/* Pagination */}
          {pagination.hasMore && (
            <div className="mt-4 flex justify-center sm:mt-5">
              <Link
                href={`/inbox/${address}?limit=${limit}&offset=${pagination.nextOffset}`}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2.5 text-center text-[12px] text-white/60 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/80 sm:w-auto sm:text-[13px]"
              >
                Load more messages
              </Link>
            </div>
          )}

          {/* Footer Links */}
          <div className="mt-4 flex items-center justify-between text-[11px] text-white/40 sm:mt-5 sm:text-[12px]">
            <Link
              href={`/agents/${agent.btcAddress}`}
              className="hover:text-white/60 transition-colors"
            >
              ← Back to Profile
            </Link>
            <Link
              href="/agents"
              className="hover:text-white/60 transition-colors"
            >
              Agent Registry
            </Link>
          </div>
        </div>
      </div>

      {/* Send Message Modal */}
      <SendMessageModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        recipientBtcAddress={agent.btcAddress}
        recipientStxAddress={agent.stxAddress}
        recipientDisplayName={displayName}
      />
    </>
  );
}
