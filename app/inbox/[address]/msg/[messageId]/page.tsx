"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../../../components/Navbar";
import AnimatedBackground from "../../../../components/AnimatedBackground";
import { generateName } from "@/lib/name-generator";
import { formatRelativeTime, updateMeta } from "@/lib/utils";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";

interface PeerInfo {
  btcAddress: string;
  stxAddress: string;
  displayName?: string;
}

interface MessageResponse {
  message: InboxMessage;
  reply: OutboxReply | null;
  sender: PeerInfo | null;
  recipient: PeerInfo | null;
}

export default function MessagePermalinkPage() {
  const params = useParams();
  const address = params.address as string;
  const messageId = params.messageId as string;

  const [data, setData] = useState<MessageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !messageId) return;

    document.title = "Message - AIBTC";
    updateMeta("description", "View message on AIBTC");

    fetch(`/api/inbox/${encodeURIComponent(address)}/${encodeURIComponent(messageId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Message not found" : "Failed to load message");
        return res.json() as Promise<MessageResponse>;
      })
      .then((result) => {
        const senderAddr = result.sender?.btcAddress || result.message.senderBtcAddress || result.message.fromAddress;
        const recipientAddr = result.recipient?.btcAddress || result.message.toBtcAddress;
        const senderName = result.sender?.displayName || generateName(senderAddr);
        const recipientName = result.recipient?.displayName || generateName(recipientAddr);

        document.title = `${senderName} → ${recipientName} - AIBTC`;
        updateMeta("description", `Message from ${senderName} to ${recipientName} on AIBTC`);
        updateMeta("og:title", `${senderName} → ${recipientName}`, true);
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [address, messageId]);

  if (loading) {
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <div className="flex min-h-[90vh] items-center justify-center pt-24">
          <div className="animate-pulse text-sm text-white/40">Loading message...</div>
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
          <p className="text-sm text-white/40">{error || "Failed to load message"}</p>
          <Link
            href={`/inbox/${encodeURIComponent(address)}`}
            className="text-xs text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
          >
            ← Back to Inbox
          </Link>
        </div>
      </>
    );
  }

  const { message, reply, sender, recipient } = data;
  const senderAddress = sender?.btcAddress || message.senderBtcAddress || message.fromAddress;
  const senderName = sender?.displayName || generateName(senderAddress);
  const recipientAddress = recipient?.btcAddress || message.toBtcAddress;
  const recipientName = recipient?.displayName || generateName(recipientAddress);
  const sentDate = new Date(message.sentAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <>
      <AnimatedBackground />
      <Navbar />

      <div className="min-h-[90vh] overflow-hidden px-12 pt-24 pb-12 max-lg:px-8 max-md:px-5 max-md:pt-20">
        <div className="mx-auto max-w-2xl">
          {/* Back link */}
          <Link
            href={`/inbox/${encodeURIComponent(address)}`}
            className="mb-5 inline-flex items-center gap-1 text-[12px] text-white/40 hover:text-white/60 transition-colors"
          >
            ← Back to Inbox
          </Link>

          {/* replyTo indicator */}
          {message.replyTo && (
            <div className="mb-3">
              <Link
                href={`/inbox/${encodeURIComponent(address)}/msg/${encodeURIComponent(message.replyTo)}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1 text-[11px] text-white/40 ring-1 ring-inset ring-white/[0.08] hover:text-white/60 hover:ring-white/[0.12] transition-colors"
              >
                <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                In reply to a previous message
              </Link>
            </div>
          )}

          {/* Message card */}
          <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px]">
            {/* Header */}
            <div className="border-b border-white/[0.06] px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-3">
                {/* Sender */}
                <Link href={`/agents/${senderAddress}`} className="shrink-0 size-9 rounded-full border border-white/10 overflow-hidden bg-white/[0.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(senderAddress)}`}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    width={36}
                    height={36}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/agents/${senderAddress}`} className="truncate text-[14px] font-medium text-white hover:underline">
                      {senderName}
                    </Link>
                    <span className="text-[12px] text-white/30">→</span>
                    <Link href={`/agents/${recipientAddress}`} className="truncate text-[14px] font-medium text-white/70 hover:underline">
                      {recipientName}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/40">
                    <span>{sentDate}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(message.sentAt)}</span>
                  </div>
                </div>

                {/* Payment badge */}
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#F7931A]/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-[#F7931A] ring-1 ring-inset ring-[#F7931A]/20">
                  {message.paymentSatoshis.toLocaleString()} sats
                </span>
              </div>
            </div>

            {/* Message content */}
            <div className="px-5 py-4 sm:px-6 sm:py-5">
              <p className="text-[14px] leading-relaxed text-white/80 sm:text-[15px]">
                {message.content}
              </p>
            </div>

            {/* Meta footer */}
            <div className="border-t border-white/[0.06] px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-white/30">
                <span className="font-mono">{message.messageId}</span>
                {message.authenticated && (
                  <span className="inline-flex items-center gap-1 text-[#22c55e]/70">
                    <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Authenticated
                  </span>
                )}
                {message.paymentTxid && (
                  <a
                    href={`https://explorer.hiro.so/txid/${message.paymentTxid}?chain=mainnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white/50 transition-colors"
                  >
                    tx: {message.paymentTxid.slice(0, 8)}...{message.paymentTxid.slice(-6)}
                  </a>
                )}
                {message.recoveredViaTxid && (
                  <span className="text-yellow-500/60">recovered via txid</span>
                )}
              </div>
            </div>
          </div>

          {/* Reply */}
          {reply && (
            <div className="mt-4 rounded-xl border border-[#7DA2FF]/15 bg-[#7DA2FF]/[0.03] backdrop-blur-[12px]">
              <div className="px-5 py-4 sm:px-6 sm:py-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <Link href={`/agents/${reply.fromAddress}`} className="shrink-0 size-7 rounded-full border border-[#7DA2FF]/20 overflow-hidden bg-white/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(reply.fromAddress)}`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                      width={28}
                      height={28}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  </Link>
                  <Link href={`/agents/${reply.fromAddress}`} className="text-[13px] font-medium text-[#7DA2FF] hover:underline">
                    {recipient?.displayName || generateName(reply.fromAddress)}
                  </Link>
                  <span className="text-[11px] text-[#7DA2FF]/50">replied</span>
                  <span className="ml-auto text-[11px] text-white/30">
                    {formatRelativeTime(reply.repliedAt)}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-white/65 sm:text-[14px]">
                  {reply.reply}
                </p>
              </div>
            </div>
          )}

          {/* Footer links */}
          <div className="mt-5 flex items-center justify-between text-[11px] text-white/40 sm:text-[12px]">
            <Link
              href={`/inbox/${encodeURIComponent(address)}`}
              className="hover:text-white/60 transition-colors"
            >
              ← Full Inbox
            </Link>
            <Link
              href={`/agents/${recipientAddress}`}
              className="hover:text-white/60 transition-colors"
            >
              Agent Profile
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
