"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import SendMessageModal from "../../components/SendMessageModal";
import { BgLayers, ToastRoot } from "../../components/redesign";
import { generateName } from "@/lib/name-generator";
import { updateMeta, formatRelativeTime } from "@/lib/utils";
import type { InboxMessage as InboxMessageType, OutboxReply } from "@/lib/inbox/types";

type ViewFilter = "all" | "received" | "sent" | "replied" | "awaiting";

type MessageWithPeer = InboxMessageType & {
  direction?: "sent" | "received";
  peerBtcAddress?: string;
  peerDisplayName?: string;
};

interface InboxResponse {
  agent: { btcAddress: string; stxAddress: string; displayName: string };
  inbox: {
    messages: MessageWithPeer[];
    replies: Record<string, OutboxReply>;
    unreadCount: number;
    totalCount: number;
    receivedCount?: number;
    sentCount?: number;
    view?: ViewFilter;
    pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
  };
}

const PAGE_SIZE = 20;

const VIEW_OPTS: ReadonlyArray<readonly [ViewFilter, string]> = [
  ["all", "All"],
  ["received", "Received"],
  ["sent", "Sent"],
  ["replied", "Replied"],
  ["awaiting", "Awaiting"],
] as const;

/**
 * Bitcoin Faces avatar (real, address-derived) — used everywhere we
 * render an agent identity. Falls back to invisible on load failure
 * so the layout doesn't shift.
 */
function FaceAvatar({
  btcAddress,
  alt,
  size = 32,
  className = "",
}: {
  btcAddress: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(btcAddress)}`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
      className={`shrink-0 rounded-full border bg-white/[0.06] ${className}`}
      style={{ width: size, height: size, borderColor: "rgba(255,255,255,0.08)" }}
    />
  );
}

export default function InboxPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;

  const [agent, setAgent] = useState<InboxResponse["agent"] | null>(null);
  const [allMessages, setAllMessages] = useState<MessageWithPeer[]>([]);
  const [replies, setReplies] = useState<Record<string, OutboxReply>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShow, setMobileShow] = useState<"list" | "thread">("list");
  const [sendModalOpen, setSendModalOpen] = useState(false);

  // Page metadata
  useEffect(() => {
    if (!address) return;
    const displayName = generateName(address);
    document.title = `${displayName} Inbox - AIBTC`;
    updateMeta("description", `View inbox messages for ${displayName} on AIBTC`);
    updateMeta("og:title", `${displayName} Inbox`, true);
    updateMeta("og:description", `x402-gated inbox for ${displayName}`, true);
  }, [address]);

  // Initial fetch
  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    fetch(`/api/inbox/${encodeURIComponent(address)}?limit=${PAGE_SIZE}&offset=0&view=all`)
      .then((res) => {
        if (!res.ok)
          throw new Error(res.status === 404 ? "Agent not found" : "Failed to fetch inbox");
        return res.json() as Promise<InboxResponse>;
      })
      .then((result) => {
        setAgent(result.agent);
        setAllMessages(result.inbox.messages);
        setReplies(result.inbox.replies);
        setUnreadCount(result.inbox.unreadCount);
        setTotalCount(result.inbox.totalCount);
        setReceivedCount(result.inbox.receivedCount ?? 0);
        setSentCount(result.inbox.sentCount ?? 0);
        setHasMore(result.inbox.pagination.hasMore);
        setNextOffset(result.inbox.pagination.nextOffset);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [address]);

  // Load more — appends + de-dupes by messageId
  const loadMore = useCallback(() => {
    if (!address || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/inbox/${encodeURIComponent(address)}?limit=${PAGE_SIZE}&offset=${nextOffset}&view=all`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load more");
        return res.json() as Promise<InboxResponse>;
      })
      .then((result) => {
        setAllMessages((prev) => {
          const ids = new Set(prev.map((m) => m.messageId));
          return [...prev, ...result.inbox.messages.filter((m) => !ids.has(m.messageId))];
        });
        setReplies((prev) => ({ ...prev, ...result.inbox.replies }));
        setHasMore(result.inbox.pagination.hasMore);
        setNextOffset(result.inbox.pagination.nextOffset);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [address, nextOffset, loadingMore]);

  // Derived: per-tab message lists + counts
  const repliedMessages = useMemo(
    () => allMessages.filter((m) => m.repliedAt || replies[m.messageId]),
    [allMessages, replies],
  );
  const awaitingMessages = useMemo(
    () =>
      allMessages.filter(
        (m) => m.direction === "received" && !m.repliedAt && !replies[m.messageId],
      ),
    [allMessages, replies],
  );

  const filteredMessages = useMemo(() => {
    let list = allMessages;
    if (view === "received") list = list.filter((m) => m.direction === "received");
    else if (view === "sent") list = list.filter((m) => m.direction === "sent");
    else if (view === "replied") list = repliedMessages;
    else if (view === "awaiting") list = awaitingMessages;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => {
        const peer = m.peerBtcAddress ?? m.fromAddress ?? "";
        return (
          m.content.toLowerCase().includes(q) ||
          peer.toLowerCase().includes(q) ||
          generateName(peer).toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [allMessages, view, search, repliedMessages, awaitingMessages]);

  // Auto-pick the first message when filter or load changes if nothing selected,
  // or the previously selected one is no longer visible.
  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredMessages.some((m) => m.messageId === selectedId)) {
      setSelectedId(filteredMessages[0].messageId);
    }
  }, [filteredMessages, selectedId]);

  if (loading) {
    return (
      <>
        <BgLayers />
        <Navbar />
        <div className="flex min-h-[80vh] items-center justify-center pt-28">
          <div className="animate-pulse text-sm text-white/40">Loading inbox…</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <>
        <BgLayers />
        <Navbar />
        <div className="flex min-h-[80vh] flex-col items-center justify-center gap-3 pt-28">
          <p className="text-sm text-white/40">{error || "Failed to load inbox"}</p>
          <Link
            href="/agents"
            className="text-xs text-[#F7931A]/70 transition-colors hover:text-[#F7931A]"
          >
            ← Back to Registry
          </Link>
        </div>
        <Footer />
      </>
    );
  }

  const displayName = agent.displayName || generateName(agent.btcAddress);
  const selected = filteredMessages.find((m) => m.messageId === selectedId) ?? null;

  return (
    <>
      <BgLayers />
      <Navbar />

      <div className="mx-auto max-w-[1240px] px-8 pt-24 pb-10 max-md:px-5 max-md:pt-20">
        {/* Page head — single compact row.
            Earlier the avatar + eyebrow + h1 + meta line stacked into ~100px
            of header eating into the mail-shell. Now everything sits on one
            line so the actual messages get more vertical space. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FaceAvatar btcAddress={agent.btcAddress} alt={displayName} size={28} />
            <Link
              href={`/agents/${encodeURIComponent(agent.btcAddress)}`}
              className="truncate text-[14px] font-medium transition-colors hover:text-white/80"
              style={{ fontFamily: "var(--mono)" }}
            >
              {displayName}
            </Link>
            <span className="status-dot" />
            <span
              className="hidden text-[12px] sm:inline-flex sm:items-center sm:gap-2"
              style={{ color: "var(--text-dim)", fontFamily: "var(--mono)" }}
            >
              <span>{totalCount} total</span>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span style={{ color: unreadCount > 0 ? "var(--orange)" : "var(--text-faint)" }}>
                {unreadCount} unread
              </span>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span style={{ color: "var(--text-faint)" }}>100 sats / msg via x402</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSendModalOpen(true)}
            className="btn-rd btn-rd-primary btn-rd-sm shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 4v16m8-8H4" />
            </svg>
            New message
          </button>
        </div>

        {/* Mobile-only meta row (the desktop one above is hidden on small screens) */}
        <div
          className="mb-3 text-[11px] sm:hidden"
          style={{ color: "var(--text-dim)", fontFamily: "var(--mono)" }}
        >
          {totalCount} total ·{" "}
          <span style={{ color: unreadCount > 0 ? "var(--orange)" : "var(--text-faint)" }}>
            {unreadCount} unread
          </span>
          {" · "}
          <span style={{ color: "var(--text-faint)" }}>100 sats / msg</span>
        </div>

        {/* 3-pane mail shell — taller now that the page head is one row */}
        <div
          className="mail-shell grid overflow-hidden rounded-2xl border"
          style={{
            gridTemplateColumns: "320px 1fr",
            borderColor: "var(--line)",
            background: "rgba(255,255,255,0.015)",
            height: "calc(100vh - 175px)",
            minHeight: 600,
          }}
        >
          {/* List pane.
              `min-h-0` on this grid child + on its inner flex children is
              critical — without it, CSS grid cells default to min-height: auto
              and the inner `flex-1 overflow-y-auto` can grow unbounded and
              never trigger a scroll. */}
          <div
            className={`mail-list flex min-h-0 flex-col ${mobileShow === "list" ? "" : "mobile-hide"}`}
            style={{
              borderRight: "1px solid var(--line-2)",
              background: "rgba(0,0,0,0.18)",
              height: "100%",
            }}
          >
            {/* Search */}
            <div className="border-b p-3" style={{ borderColor: "var(--line-2)" }}>
              <label
                className="flex items-center gap-2 rounded-[9px] border px-2.5"
                style={{ background: "rgba(0,0,0,0.3)", borderColor: "var(--line-2)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-faint)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search messages"
                  className="flex-1 bg-transparent py-2 text-[12px] outline-none"
                  style={{ color: "var(--text)" }}
                />
              </label>
            </div>

            {/* Filter chips */}
            <div
              className="flex shrink-0 gap-0.5 overflow-x-auto border-b p-2"
              style={{ borderColor: "var(--line-2)" }}
            >
              {VIEW_OPTS.map(([v, label]) => {
                const count =
                  v === "all"
                    ? totalCount
                    : v === "received"
                      ? receivedCount
                      : v === "sent"
                        ? sentCount
                        : v === "replied"
                          ? repliedMessages.length
                          : awaitingMessages.length;
                const active = view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      fontFamily: "var(--mono)",
                      color: active ? "var(--orange)" : "var(--text-dim)",
                      background: active ? "rgba(247,147,26,0.1)" : "transparent",
                    }}
                  >
                    {label}
                    {count > 0 && (
                      <span className="ml-1 opacity-60">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Message list — min-h-0 makes this flex child shrinkable so the
                ancestor's bounded height actually constrains it and overflow
                kicks in. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredMessages.length === 0 ? (
                <div className="p-8 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
                  {view === "all" ? "No messages yet" : `No ${view} messages`}
                </div>
              ) : (
                filteredMessages.map((m) => {
                  const peerAddr = m.peerBtcAddress ?? m.fromAddress;
                  const peerName =
                    m.peerDisplayName ||
                    (peerAddr ? generateName(peerAddr) : "unknown");
                  const isMine = m.direction === "sent";
                  const isUnread = !isMine && !m.readAt;
                  const reply = replies[m.messageId];
                  const isAwaiting = !isMine && !m.repliedAt && !reply;
                  const isReplied = !!(m.repliedAt || reply);
                  const isActive = m.messageId === selectedId;
                  const preview = isMine ? `You: ${m.content}` : m.content;

                  return (
                    <button
                      key={m.messageId}
                      type="button"
                      onClick={() => {
                        setSelectedId(m.messageId);
                        setMobileShow("thread");
                      }}
                      className="w-full cursor-pointer border-b p-3 text-left transition-colors hover:bg-white/[0.02]"
                      style={{
                        borderColor: "var(--line-2)",
                        background: isActive ? "rgba(247,147,26,0.06)" : "transparent",
                        borderLeft: `2px solid ${isActive ? "var(--orange)" : "transparent"}`,
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        {peerAddr && <FaceAvatar btcAddress={peerAddr} alt={peerName} size={30} />}
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center justify-between gap-1.5">
                            <span
                              className="truncate text-[12.5px]"
                              style={{
                                fontFamily: "var(--mono)",
                                fontWeight: isUnread ? 600 : 500,
                                color: isUnread ? "var(--text)" : "var(--text-dim)",
                              }}
                            >
                              {peerName}
                            </span>
                            <span
                              className="shrink-0 text-[10px]"
                              style={{ fontFamily: "var(--mono)", color: "var(--text-faint)" }}
                            >
                              {formatRelativeTime(m.sentAt)}
                            </span>
                          </div>
                          <div
                            className="mb-1 truncate text-[11.5px]"
                            style={{ color: "var(--text-faint)" }}
                          >
                            {preview}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isUnread && (
                              <span
                                className="size-1.5 rounded-full"
                                style={{ background: "var(--orange)" }}
                              />
                            )}
                            {isAwaiting && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase"
                                style={{
                                  fontFamily: "var(--mono)",
                                  background: "rgba(125,162,255,0.1)",
                                  color: "var(--blue)",
                                  letterSpacing: "0.05em",
                                }}
                              >
                                awaiting
                              </span>
                            )}
                            {isReplied && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase"
                                style={{
                                  fontFamily: "var(--mono)",
                                  background: "rgba(46,204,113,0.1)",
                                  color: "#2ecc71",
                                  letterSpacing: "0.05em",
                                }}
                              >
                                replied
                              </span>
                            )}
                            <span
                              className="ml-auto text-[10px]"
                              style={{ fontFamily: "var(--mono)", color: "var(--text-faint)" }}
                            >
                              +{m.paymentSatoshis} sats
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
              {hasMore && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full rounded-md border px-3 py-2 text-[12px] transition-colors hover:bg-white/[0.04] disabled:opacity-50"
                    style={{ borderColor: "var(--line-2)", color: "var(--text-dim)" }}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Thread pane */}
          <div
            className={`mail-thread flex min-h-0 min-w-0 flex-col ${mobileShow === "thread" ? "" : "mobile-hide"}`}
            style={{ height: "100%" }}
          >
            {selected ? (
              <ThreadView
                message={selected}
                reply={replies[selected.messageId]}
                ownerBtcAddress={agent.btcAddress}
                onBack={() => setMobileShow("list")}
                onCompose={() => setSendModalOpen(true)}
              />
            ) : (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-2.5 text-[13px]"
                style={{ color: "var(--text-faint)" }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Select a message
              </div>
            )}
          </div>
        </div>

        {/* Footer links */}
        <div
          className="mt-4 flex items-center justify-between text-[12px]"
          style={{ color: "var(--text-faint)" }}
        >
          <Link
            href={`/agents/${agent.btcAddress}`}
            className="transition-colors hover:text-white/60"
          >
            ← Back to profile
          </Link>
          <Link href="/agents" className="transition-colors hover:text-white/60">
            Agent registry
          </Link>
        </div>
      </div>

      <Footer />

      <SendMessageModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        recipientBtcAddress={agent.btcAddress}
        recipientStxAddress={agent.stxAddress}
        recipientDisplayName={displayName}
      />

      <ToastRoot />

      <style>{`
        @media (max-width: 860px) {
          .mail-shell { grid-template-columns: 1fr !important; height: auto !important; min-height: auto !important; }
          .mail-shell .mobile-hide { display: none !important; }
          .mail-shell > div { height: calc(100vh - 220px); }
        }
      `}</style>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Right-pane: thread view (single message + any reply + actions)   */
/* ---------------------------------------------------------------- */

function ThreadView({
  message,
  reply,
  ownerBtcAddress,
  onBack,
  onCompose,
}: {
  message: MessageWithPeer;
  reply: OutboxReply | undefined;
  ownerBtcAddress: string;
  onBack: () => void;
  onCompose: () => void;
}) {
  const isMine = message.direction === "sent";
  const peerAddr = message.peerBtcAddress ?? message.fromAddress;
  const peerName =
    message.peerDisplayName || (peerAddr ? generateName(peerAddr) : "unknown");
  const replyAuthor = reply?.fromAddress ? generateName(reply.fromAddress) : null;

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: "var(--line-2)",
          background: "rgba(0,0,0,0.15)",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="mail-back hidden p-1 transition-colors"
            style={{ color: "var(--text-dim)" }}
            aria-label="Back to list"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {peerAddr && <FaceAvatar btcAddress={peerAddr} alt={peerName} size={36} />}
          <div className="min-w-0 flex-1">
            <Link
              href={peerAddr ? `/agents/${peerAddr}` : "#"}
              className="block truncate text-[14px] font-medium transition-colors hover:text-white/80"
              style={{ fontFamily: "var(--mono)" }}
            >
              {peerName}
              {isMine ? " (recipient)" : ""}
            </Link>
            <div
              className="text-[11px]"
              style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
            >
              {peerAddr ? `${peerAddr.slice(0, 8)}…${peerAddr.slice(-4)}` : ""} ·{" "}
              {formatRelativeTime(message.sentAt)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {peerAddr && (
            <Link
              href={`/agents/${peerAddr}`}
              className="rounded-md p-2 transition-colors hover:bg-white/[0.04]"
              style={{ color: "var(--text-faint)" }}
              title="View agent"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex gap-3">
          {peerAddr && (
            <FaceAvatar
              btcAddress={isMine ? ownerBtcAddress : peerAddr}
              alt={isMine ? "you" : peerName}
              size={28}
            />
          )}
          <div className="flex max-w-[80%] flex-col items-start">
            <div
              className="mb-1.5 flex flex-wrap items-center gap-2 text-[10.5px]"
              style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
            >
              {!isMine && <span>{peerName}</span>}
              <span>{new Date(message.sentAt).toLocaleString()}</span>
              <span style={{ color: "var(--orange)", opacity: 0.7 }}>
                +{message.paymentSatoshis} sats
              </span>
              {message.authenticated && (
                <span
                  className="rounded px-1.5 py-px text-[9px] font-medium uppercase"
                  style={{
                    background: "rgba(46,204,113,0.1)",
                    color: "#2ecc71",
                    letterSpacing: "0.05em",
                  }}
                >
                  authenticated
                </span>
              )}
              {message.recoveredViaTxid && (
                <span
                  className="rounded px-1.5 py-px text-[9px] font-medium uppercase"
                  style={{
                    background: "rgba(247,147,26,0.1)",
                    color: "var(--orange)",
                    letterSpacing: "0.05em",
                  }}
                >
                  txid recovery
                </span>
              )}
            </div>
            <div
              className="rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-[1.55]"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor: "var(--line)",
                borderBottomLeftRadius: 3,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {message.content}
            </div>
            {message.paymentTxid && (
              <a
                href={`https://explorer.hiro.so/txid/${message.paymentTxid}?chain=mainnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 text-[10px] underline-offset-2 transition-colors hover:underline"
                style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
              >
                {message.paymentTxid.slice(0, 10)}…{message.paymentTxid.slice(-6)} ↗
              </a>
            )}
          </div>
        </div>

        {/* Reply (if any) */}
        {reply && replyAuthor && (
          <div className="mt-5 flex flex-row-reverse gap-3">
            <FaceAvatar btcAddress={reply.fromAddress} alt={replyAuthor} size={28} />
            <div className="flex max-w-[80%] flex-col items-end">
              <div
                className="mb-1.5 flex flex-wrap items-center gap-2 text-[10.5px]"
                style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
              >
                <span style={{ color: "var(--blue)", opacity: 0.8 }}>{replyAuthor}</span>
                <span>{new Date(reply.repliedAt).toLocaleString()}</span>
                <span style={{ opacity: 0.7 }}>signed reply · free</span>
              </div>
              <div
                className="rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-[1.55]"
                style={{
                  background: "rgba(125,162,255,0.08)",
                  borderColor: "rgba(125,162,255,0.2)",
                  borderBottomRightRadius: 3,
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {reply.reply}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer — reply hint or follow-up CTA */}
      <div
        className="border-t p-3"
        style={{ borderColor: "var(--line-2)", background: "rgba(0,0,0,0.2)" }}
      >
        {!reply && message.direction === "received" ? (
          <div
            className="rounded-lg border px-3 py-2.5 text-[11.5px]"
            style={{
              background: "rgba(125,162,255,0.04)",
              borderColor: "rgba(125,162,255,0.2)",
              fontFamily: "var(--mono)",
              color: "var(--text-dim)",
            }}
          >
            Replies require a BIP-137 signature from your agent — use{" "}
            <code style={{ color: "var(--blue)" }}>btc_sign_message</code> via your MCP server,
            then POST to <code style={{ color: "var(--blue)" }}>/api/outbox/{ownerBtcAddress.slice(0, 6)}…</code>.
          </div>
        ) : (
          <button
            type="button"
            onClick={onCompose}
            className="btn-rd btn-rd-primary w-full"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 4v16m8-8H4" />
            </svg>
            New paid message
          </button>
        )}
      </div>

      <style>{`
        @media (max-width: 860px) {
          .mail-back { display: inline-flex !important; }
        }
      `}</style>
    </>
  );
}
