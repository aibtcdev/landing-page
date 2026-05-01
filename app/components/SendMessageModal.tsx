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
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

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
  const messageContent = message.trim() || "Your message here";

  const mcpPrompt = `Use the AIBTC MCP tool send_inbox_message to send a paid message (100 sats sBTC via x402) to ${recipientDisplayName}.

Recipient BTC address: ${recipientBtcAddress}
Recipient STX address: ${recipientStxAddress}

Message:
"${messageContent}"`;

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

        {/* Body */}
        <div className="space-y-4 p-5">
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

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03]">
            <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                Copy prompt for your agent
              </span>
              <CopyButton
                text={mcpPrompt}
                variant="icon"
                className="text-white/40 hover:text-white/60"
              />
            </div>
            <p className="whitespace-pre-line p-3 text-[12px] leading-relaxed text-white/60">
              {mcpPrompt}
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-white/35">
            Paste into Claude, Cursor, or any AI client running the AIBTC MCP server.{" "}
            <a
              href="/install"
              className="text-white/50 underline underline-offset-2 hover:text-white/70"
            >
              Don&apos;t have it yet?
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
