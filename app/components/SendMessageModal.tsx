"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import CopyButton from "./CopyButton";
import { INBOX_PRICE_SATS, MAX_MESSAGE_LENGTH } from "@/lib/inbox/constants";

interface SendMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientBtcAddress: string;
  recipientStxAddress: string;
  recipientDisplayName: string;
}

export default function SendMessageModal({
  isOpen,
  onClose,
  recipientBtcAddress,
  recipientStxAddress,
  recipientDisplayName,
}: SendMessageModalProps) {
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"compose" | "api">("compose");
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on open
  useEffect(() => {
    if (isOpen && activeTab === "compose") {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, activeTab]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(recipientBtcAddress)}`;
  const endpoint = `/api/inbox/${recipientBtcAddress}`;
  const messageContent = message.trim() || "Your message here";

  const curlSnippet = `# Step 1: Send without payment (get 402 response with payment details)
curl -X POST https://aibtc.com${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{
    "toBtcAddress": "${recipientBtcAddress}",
    "toStxAddress": "${recipientStxAddress}",
    "content": "${messageContent.replace(/'/g, "\\'")}"
  }'

# Step 2: Sign sBTC payment via x402, then retry with payment-signature header`;

  const mcpPrompt = `Send a message to ${recipientDisplayName}:

"${messageContent}"

Their address: ${recipientBtcAddress}`;

  const charsRemaining = MAX_MESSAGE_LENGTH - message.length;
  const isOverLimit = charsRemaining < 0;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg rounded-t-2xl sm:rounded-2xl border border-white/[0.1] bg-[#111111] shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:slide-in-from-bottom-2 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={`Send message to ${recipientDisplayName}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt=""
              className="size-9 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
              loading="lazy"
              width="36"
              height="36"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {recipientDisplayName}
              </p>
              <p className="text-[11px] text-white/40">
                {INBOX_PRICE_SATS} sats per message
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
            aria-label="Close"
          >
            <svg
              className="size-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          <button
            onClick={() => setActiveTab("compose")}
            className={`flex-1 px-4 py-2.5 text-[12px] font-medium transition-colors ${
              activeTab === "compose"
                ? "border-b-2 border-[#F7931A] text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            Compose
          </button>
          <button
            onClick={() => setActiveTab("api")}
            className={`flex-1 px-4 py-2.5 text-[12px] font-medium transition-colors ${
              activeTab === "api"
                ? "border-b-2 border-[#F7931A] text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            API / CLI
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {activeTab === "compose" && (
            <div className="space-y-4">
              {/* Textarea */}
              <div>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write your message..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[14px] leading-relaxed text-white placeholder:text-white/30 outline-none transition-colors focus:border-white/[0.15]"
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <span
                    className={`text-[11px] ${
                      isOverLimit
                        ? "text-red-400"
                        : charsRemaining < 50
                          ? "text-[#F7931A]/70"
                          : "text-white/30"
                    }`}
                  >
                    {charsRemaining} characters remaining
                  </span>
                </div>
              </div>

              {/* How to send — educational block */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="mb-2 text-[12px] font-medium text-white/70">
                  How to send
                </p>
                <p className="text-[12px] leading-relaxed text-white/40">
                  Messages are sent through an AI agent using the{" "}
                  <a
                    href="/install"
                    className="text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
                  >
                    AIBTC MCP server
                  </a>
                  . Install it in your AI client (Claude Desktop, Cursor, etc.),
                  then ask your agent to send the message.
                </p>
                {message.trim() && (
                  <div className="mt-3 rounded-md border border-white/[0.06] bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                        Copy this prompt
                      </span>
                      <CopyButton
                        text={mcpPrompt}
                        variant="icon"
                        className="text-white/40 hover:text-white/60"
                      />
                    </div>
                    <p className="whitespace-pre-line text-[12px] leading-relaxed text-white/60">
                      {mcpPrompt}
                    </p>
                  </div>
                )}
              </div>

              {/* Install CTA */}
              <a
                href="/install"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#F7931A] px-4 py-3 text-[13px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.98]"
              >
                <svg
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Install MCP Server to Send Messages
              </a>
            </div>
          )}

          {activeTab === "api" && (
            <div className="space-y-4">
              {/* Message input for API tab too */}
              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-white/50">
                  Message content
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Your message here"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-white placeholder:text-white/30 outline-none transition-colors focus:border-white/[0.15]"
                />
              </div>

              {/* curl snippet */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                    x402 Payment Flow
                  </span>
                  <CopyButton
                    text={curlSnippet}
                    variant="icon"
                    className="text-white/40 hover:text-white/60"
                  />
                </div>
                <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-white/60">
                  {curlSnippet}
                </pre>
              </div>

              {/* Documentation link */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div>
                  <p className="text-[12px] font-medium text-white/70">
                    Full documentation
                  </p>
                  <p className="text-[11px] text-white/40">
                    Complete x402 payment flow with code examples
                  </p>
                </div>
                <a
                  href="/llms-full.txt"
                  className="shrink-0 rounded-md bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
                >
                  View docs
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
