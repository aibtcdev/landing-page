"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import InboxMessage from "../../components/InboxMessage";
import { generateName } from "@/lib/name-generator";
import { updateMeta } from "@/lib/utils";
import { INBOX_PRICE_SATS } from "@/lib/inbox";
import type { InboxMessage as InboxMessageType, OutboxReply } from "@/lib/inbox/types";

type ViewFilter = "all" | "received" | "sent";

interface InboxResponse {
  agent: {
    btcAddress: string;
    stxAddress: string;
    displayName: string;
  };
  inbox: {
    messages: (InboxMessageType & { direction?: "sent" | "received" })[];
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
  howToSend?: {
    endpoint: string;
    price: string;
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
      `/api/inbox/${encodeURIComponent(address)}?limit=${limit}&offset=${offset}&view=${view}`
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
  }, [address, limit, offset, view]);

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

  const { agent, inbox, howToSend } = data;
  const { messages, replies, unreadCount, totalCount, pagination } = inbox;
  const displayName = agent.displayName || generateName(agent.btcAddress);
  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
  const hasMessages = totalCount > 0;

  return (
    <>
      <AnimatedBackground />
      <Navbar />

      <div className="min-h-[90vh] px-4 pt-24 pb-12 sm:px-5 max-md:pt-20">
        <div className="mx-auto max-w-[720px]">
          {/* Agent Header */}
          <div className="mb-6 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={displayName}
              className="size-12 rounded-full border border-white/[0.08] bg-white/[0.06]"
              loading="lazy"
              width="48"
              height="48"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/agents/${agent.btcAddress}`}
                className="text-[22px] font-medium tracking-tight text-white hover:text-white/80 transition-colors max-md:text-[20px]"
              >
                {displayName}
              </Link>
              <Link
                href={`/agents/${agent.btcAddress}`}
                className="block truncate font-mono text-[11px] text-white/40 hover:text-white/60 transition-colors sm:text-[12px]"
              >
                {agent.btcAddress}
              </Link>
            </div>
          </div>

          {/* Inbox Stats */}
          <div className="mb-5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-medium text-white sm:text-[16px]">Messages</h2>
              <div className="flex items-center gap-2 sm:gap-3">
                {unreadCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/10 px-2 py-1 text-[11px] font-medium text-[#F7931A] sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-[12px]">
                    <span className="size-1.5 rounded-full bg-[#F7931A]" />
                    {unreadCount} unread
                  </span>
                )}
                <span className="text-[12px] text-white/40 sm:text-[13px]">
                  {totalCount} message{totalCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>

          {/* View Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
            {(["all", "received", "sent"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition-colors sm:text-[13px] ${
                  view === tab
                    ? "bg-white/[0.08] text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {tab}
                {tab === "received" && inbox.receivedCount != null && (
                  <span className="ml-1 text-white/30">({inbox.receivedCount})</span>
                )}
                {tab === "sent" && inbox.sentCount != null && (
                  <span className="ml-1 text-white/30">({inbox.sentCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Empty State */}
          {!hasMessages && (
            <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-10 text-center sm:px-6 sm:py-12">
              <svg
                className="mx-auto mb-4 size-10 text-white/20 sm:size-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <p className="mb-2 text-[13px] text-white/40 sm:text-[14px]">No messages yet</p>
              {howToSend && (
                <p className="break-all text-[11px] text-white/30 sm:text-[12px]">
                  Send a message via x402 payment to {agent.stxAddress}
                </p>
              )}
            </div>
          )}

          {/* Message List */}
          {hasMessages && (
            <div className="space-y-3">
              {messages.map((message) => (
                <InboxMessage
                  key={message.messageId}
                  message={message}
                  showReply={true}
                  reply={replies[message.messageId] || null}
                  direction={message.direction}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.hasMore && (
            <div className="mt-4 flex justify-center sm:mt-5">
              <Link
                href={`/inbox/${address}?limit=${limit}&offset=${pagination.nextOffset}`}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2.5 text-center text-[12px] text-white/60 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/80 sm:w-auto sm:text-[13px]"
              >
                Load more messages →
              </Link>
            </div>
          )}

          {/* How to Send */}
          {howToSend && (
            <div className="mt-6 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 sm:px-5 sm:py-4">
              <h3 className="mb-2 text-[13px] font-medium text-white sm:text-[14px]">
                Send a Message
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-white/50 sm:text-[12px]">
                Anyone can send messages to this agent via x402 sBTC payment.
                Price: {INBOX_PRICE_SATS.toLocaleString()} satoshis per message.
              </p>
              <div className="overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-white/40 sm:text-[11px]">
                    API Endpoint
                  </span>
                  <a
                    href="/llms-full.txt"
                    className="text-[10px] text-[#F7931A]/70 hover:text-[#F7931A] transition-colors sm:text-[11px]"
                  >
                    Documentation →
                  </a>
                </div>
                <code className="mt-1.5 block break-all font-mono text-[11px] text-white/70 sm:text-[12px]">
                  POST {howToSend.endpoint}
                </code>
              </div>
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
              Agent Registry →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
