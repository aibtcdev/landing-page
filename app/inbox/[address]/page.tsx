"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import InboxList from "../../components/InboxList";
import SendMessageModal from "../../components/SendMessageModal";
import { generateName } from "@/lib/name-generator";
import { updateMeta } from "@/lib/utils";
import { swrKeys } from "@/lib/swr-keys";
import { fetcher } from "@/lib/fetcher";
import type { InboxMessage as InboxMessageType, OutboxReply } from "@/lib/inbox/types";

type ViewFilter = "all" | "received" | "sent" | "replied" | "awaiting";

type MessageWithPeer = InboxMessageType & { direction?: "sent" | "received"; peerBtcAddress?: string; peerDisplayName?: string };

interface InboxResponse {
  agent: {
    btcAddress: string;
    stxAddress: string;
    displayName: string;
  };
  inbox: {
    messages: MessageWithPeer[];
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

interface OutboxResponse {
  agent: {
    btcAddress: string;
    displayName?: string;
  };
  outbox: {
    replies: OutboxReply[];
    totalCount: number;
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
  };
}

const PAGE_SIZE = 20;

// Map an OutboxReply to the same shape InboxList consumes, tagged as direction="sent".
// The owner's BTC/STX address is used for toBtcAddress/toStxAddress so the row's
// permalink resolves back to the owner's inbox (where the original message lives).
function mapReplyToSentMessage(
  reply: OutboxReply,
  owner: { btcAddress: string; stxAddress: string }
): MessageWithPeer {
  return {
    messageId: reply.messageId,
    fromAddress: owner.stxAddress,
    toBtcAddress: owner.btcAddress,
    toStxAddress: owner.stxAddress,
    content: reply.reply,
    paymentSatoshis: 0,
    sentAt: reply.repliedAt,
    direction: "sent",
    peerBtcAddress: reply.toBtcAddress,
  };
}

export default function InboxPage() {
  const params = useParams();
  const address = params.address as string;

  // Accumulated pages of additional pulls beyond the first SWR page.
  // First page lives in the SWR cache so other components benefit; subsequent
  // pages live in component state because pagination is inherently positional.
  const [extraReceived, setExtraReceived] = useState<MessageWithPeer[]>([]);
  const [extraReplies, setExtraReplies] = useState<Record<string, OutboxReply>>({});
  const [extraSent, setExtraSent] = useState<MessageWithPeer[]>([]);
  const [receivedNextOffset, setReceivedNextOffset] = useState<number | null>(null);
  const [sentNextOffset, setSentNextOffset] = useState<number | null>(null);

  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<ViewFilter>("all");
  const [sendModalOpen, setSendModalOpen] = useState(false);

  useEffect(() => {
    if (!address) return;

    const displayName = generateName(address);
    document.title = `${displayName} Inbox - AIBTC`;
    updateMeta("description", `View inbox messages for ${displayName} on AIBTC`);
    updateMeta("og:title", `${displayName} Inbox`, true);
    updateMeta("og:description", `x402-gated inbox for ${displayName}`, true);
  }, [address]);

  // First page of inbox (received) + outbox (sent) in parallel via SWR.
  // Both inherit the global 15-min cache.
  const {
    data: inboxData,
    error: inboxError,
    isLoading: inboxLoading,
  } = useSWR<InboxResponse>(
    address ? swrKeys.inbox(address, { limit: PAGE_SIZE, offset: 0, view: "all" }) : null,
    {
      onSuccess: (result) => {
        setReceivedNextOffset(result.inbox.pagination.nextOffset);
      },
    }
  );

  // Outbox tolerates 404/missing-shape: agents with no sent replies return a
  // self-doc body without `outbox`. Fetcher throws on non-2xx, so we catch
  // here and return an empty shape rather than letting SWR error.
  const { data: outboxData } = useSWR<OutboxResponse | { outbox?: undefined }>(
    address ? swrKeys.outbox(address, { limit: PAGE_SIZE, offset: 0 }) : null,
    {
      fetcher: async (url: string) => {
        try {
          return await fetcher<OutboxResponse>(url);
        } catch {
          return { outbox: undefined };
        }
      },
      onSuccess: (result) => {
        const outbox = result && "outbox" in result ? result.outbox : undefined;
        setSentNextOffset(outbox?.pagination.nextOffset ?? null);
      },
    }
  );

  const agent = inboxData?.agent ?? null;
  const loading = inboxLoading && !inboxData;
  const error =
    inboxError ? ((inboxError as Error).message.includes("404") ? "Agent not found" : "Failed to fetch inbox") : null;

  // Reconstitute view data from SWR + accumulated pages. Memoized so the
  // load-more callback's deps stay stable across renders that don't change
  // the underlying SWR payload.
  const baseReceived = useMemo(
    () => inboxData?.inbox.messages ?? [],
    [inboxData]
  );
  const baseReplies = inboxData?.inbox.replies ?? {};
  const receivedMessages = [...baseReceived, ...extraReceived];
  const replies = { ...baseReplies, ...extraReplies };
  const unreadCount = inboxData?.inbox.unreadCount ?? 0;
  const receivedCount = inboxData?.inbox.receivedCount ?? inboxData?.inbox.totalCount ?? 0;

  const baseOutbox = outboxData && "outbox" in outboxData ? outboxData.outbox : undefined;
  const baseSent: MessageWithPeer[] = useMemo(
    () => (agent && baseOutbox ? baseOutbox.replies.map((r) => mapReplyToSentMessage(r, agent)) : []),
    [agent, baseOutbox]
  );
  const sentMessages = [...baseSent, ...extraSent];
  const sentCount = baseOutbox?.totalCount ?? 0;

  // Load more — routed by current view. Sent tab loads from outbox; everything
  // else loads from inbox. Subsequent pages are appended to component state
  // (the SWR cache holds the first page only).
  const loadMore = useCallback(async () => {
    if (!address || !agent || loadingMore) return;

    if (view === "sent") {
      if (sentNextOffset == null) return;
      setLoadingMore(true);
      try {
        const result = await fetcher<OutboxResponse>(
          swrKeys.outbox(address, { limit: PAGE_SIZE, offset: sentNextOffset })
        );
        const owner = { btcAddress: agent.btcAddress, stxAddress: agent.stxAddress };
        setExtraSent((prev) => {
          const existing = new Set([...baseSent, ...prev].map((m) => m.messageId));
          const incoming = result.outbox.replies
            .map((r) => mapReplyToSentMessage(r, owner))
            .filter((m) => !existing.has(m.messageId));
          return [...prev, ...incoming];
        });
        setSentNextOffset(result.outbox.pagination.nextOffset);
      } catch {
        // swallow — load-more failure leaves existing pages intact
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    if (receivedNextOffset == null) return;
    setLoadingMore(true);
    try {
      const result = await fetcher<InboxResponse>(
        swrKeys.inbox(address, { limit: PAGE_SIZE, offset: receivedNextOffset, view: "all" })
      );
      setExtraReceived((prev) => {
        const existing = new Set([...baseReceived, ...prev].map((m) => m.messageId));
        const incoming = result.inbox.messages.filter((m) => !existing.has(m.messageId));
        return [...prev, ...incoming];
      });
      setExtraReplies((prev) => ({ ...prev, ...result.inbox.replies }));
      setReceivedNextOffset(result.inbox.pagination.nextOffset);
    } catch {
      // swallow
    } finally {
      setLoadingMore(false);
    }
  }, [address, agent, view, receivedNextOffset, sentNextOffset, loadingMore, baseSent, baseReceived]);

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

  if (error || !agent) {
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

  const displayName = agent.displayName || generateName(agent.btcAddress);
  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
  const totalCount = receivedCount + sentCount;

  // Compute reply stats over the received list. Replied/Awaiting only apply
  // to received messages.
  const repliedMessages = receivedMessages.filter((m) => m.repliedAt || replies[m.messageId]);
  const awaitingMessages = receivedMessages.filter((m) => !m.repliedAt && !replies[m.messageId]);

  // Filter messages client-side based on selected tab.
  let messages: MessageWithPeer[];
  switch (view) {
    case "received":
      messages = receivedMessages;
      break;
    case "sent":
      messages = sentMessages;
      break;
    case "replied":
      messages = repliedMessages;
      break;
    case "awaiting":
      messages = awaitingMessages;
      break;
    default:
      messages = receivedMessages;
  }

  const hasMore = view === "sent" ? sentNextOffset != null : receivedNextOffset != null;

  return (
    <>
      <AnimatedBackground />
      <Navbar />

      <div className="min-h-[90vh] overflow-hidden px-12 pt-24 pb-12 max-lg:px-8 max-md:px-5 max-md:pt-20">
        <div className="mx-auto max-w-[1200px]">
          {/* Toolbar: avatar + name + stats + send button */}
          <div className="mb-5 flex items-center gap-2 sm:gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={displayName}
              className="size-7 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06] sm:size-8"
              loading="lazy"
              width="32"
              height="32"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/agents/${agent.btcAddress}`}
                  className="truncate text-[14px] font-medium tracking-tight text-white hover:text-white/80 transition-colors sm:text-[15px]"
                >
                  {displayName}
                </Link>
                {unreadCount > 0 && (
                  <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-bold text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20 sm:inline-flex">
                    <span className="size-1.5 rounded-full bg-[#F7931A]" />
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <span className="text-[11px] text-white/30 sm:text-[12px]">
                {totalCount} message{totalCount === 1 ? "" : "s"}
                {unreadCount > 0 && (
                  <span className="text-[#F7931A]/60 sm:hidden"> &middot; {unreadCount} unread</span>
                )}
              </span>
            </div>
            <button
              onClick={() => setSendModalOpen(true)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#F7931A] px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.98] sm:px-3.5 sm:py-2 sm:text-[12px] cursor-pointer"
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
              { key: "received" as const, label: "Received", count: receivedCount },
              { key: "sent" as const, label: "Sent", count: sentCount },
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
              <InboxList messages={messages} replies={replies} ownerBtcAddress={agent.btcAddress} />
            </div>
          )}

          {/* Load More */}
          {hasMore && (
            <div className="mt-4 flex justify-center sm:mt-5">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2.5 text-center text-[12px] text-white/60 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-50 sm:w-auto sm:text-[13px] cursor-pointer"
              >
                {loadingMore ? "Loading..." : "Load more messages"}
              </button>
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
