"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  variant?: "primary" | "secondary" | "icon";
  className?: string;
}

export default function CopyButton({
  text,
  label = "Copy",
  variant = "secondary",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Variant styles
  const variantStyles = {
    primary: copied
      ? "border-green-500/50 bg-green-500/10 text-green-400"
      : "border-white/10 bg-white/[0.05] text-white/70 hover:border-[#F7931A]/50 hover:bg-[#F7931A]/10 hover:text-white",
    secondary: copied
      ? "border-green-500/30 bg-green-500/5 text-green-400"
      : "border-white/[0.08] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04] text-white/60 hover:text-white",
    icon: copied
      ? "text-green-400"
      : "text-white/50 hover:text-white",
  };

  if (variant === "icon") {
    // Icon-only mode (no label text)
    if (!label) {
      return (
        <button
          onClick={handleCopy}
          className={`inline-flex transition-colors ${variantStyles.icon} ${className}`}
        >
          <svg
            className="size-3.5 transition-all"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            {copied ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            )}
          </svg>
        </button>
      );
    }

    // Icon with label
    return (
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-2 transition-colors ${variantStyles.icon} ${className}`}
      >
        <svg
          className="size-4 transition-all"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          {copied ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          )}
        </svg>
        <span>{copied ? "Copied!" : label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium transition-all duration-300 ${variantStyles[variant]} ${className}`}
    >
      {copied ? (
        <>
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
