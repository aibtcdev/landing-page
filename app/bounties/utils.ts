/**
 * Bounty UI utilities.
 *
 * Status styles cover the six derived states from lib/bounty/types.ts:
 *   open / judging / winner-announced / paid / abandoned / cancelled
 */

import type { BountyStatus } from "@/lib/bounty";

export const STATUS_STYLES: Record<BountyStatus, string> = {
  open: "text-emerald-400/90 bg-emerald-400/[0.08] border-emerald-400/20",
  judging: "text-amber-400/90 bg-amber-400/[0.08] border-amber-400/20",
  "winner-announced": "text-[#7DA2FF]/90 bg-[#7DA2FF]/[0.08] border-[#7DA2FF]/20",
  paid: "text-[#F7931A]/90 bg-[#F7931A]/[0.08] border-[#F7931A]/20",
  abandoned: "text-red-400/80 bg-red-400/[0.06] border-red-400/20",
  cancelled: "text-white/40 bg-white/[0.04] border-white/[0.06]",
};

export const STATUS_LABELS: Record<BountyStatus, string> = {
  open: "Open",
  judging: "Judging",
  "winner-announced": "Winner",
  paid: "Paid",
  abandoned: "Abandoned",
  cancelled: "Cancelled",
};

/**
 * Text colour for the status dot + word treatment used on cards, where the hue
 * carries the state and there is no bordered badge competing with the title.
 * `STATUS_STYLES` above is the boxed-badge variant, still used where a status
 * needs to read as a discrete chip.
 */
export const STATUS_TEXT: Record<BountyStatus, string> = {
  open: "text-emerald-400",
  judging: "text-amber-400",
  "winner-announced": "text-[#7DA2FF]",
  paid: "text-[#F7931A]",
  abandoned: "text-rose-400",
  cancelled: "text-white/45",
};

export function statusText(status: BountyStatus | string): string {
  return STATUS_TEXT[status as BountyStatus] ?? STATUS_TEXT.cancelled;
}

export function statusStyle(status: BountyStatus | string): string {
  return STATUS_STYLES[status as BountyStatus] ?? STATUS_STYLES.cancelled;
}

export function statusLabel(status: BountyStatus | string): string {
  return STATUS_LABELS[status as BountyStatus] ?? status;
}

export function formatSats(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

/**
 * Every digit, grouped — "21,000", not "21k".
 *
 * The reward is the number a reader is deciding on, so the display figure on a
 * card or a detail header shows it in full. `formatSats` stays for the places
 * that are summing rather than quoting, where the abbreviation is the point.
 */
export function formatSatsFull(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Cut `input` to at most `max` characters on a word boundary, so a "Read more"
 * affordance lands after a whole word instead of mid-token.
 *
 * Returns `truncated: false` when the text already fits, which is the caller's
 * signal to render no affordance at all. Falls back to a hard cut when the
 * window holds no space (a single long token), and drops a trailing separator
 * so the ellipsis doesn't read as ",…".
 */
export function truncateAtWord(
  input: string,
  max: number
): { text: string; truncated: boolean } {
  if (input.length <= max) return { text: input, truncated: false };
  const window = input.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > max * 0.4 ? window.slice(0, lastSpace) : window;
  return { text: cut.replace(/[\s.,;:—-]+$/, ""), truncated: true };
}

export function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Label shown on a card describing the submission window. */
export function submissionWindowLabel(expiresAt: string, status: BountyStatus): string | null {
  if (status === "paid" || status === "cancelled" || status === "abandoned") return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff < 0) return "Submissions closed";
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.max(1, Math.floor(diff / 3600000));
    return `Closes in ${hours}h`;
  }
  if (days === 1) return "Closes in 1 day";
  return `Closes in ${days} days`;
}

/**
 * Strip common Markdown syntax so a description can be shown as a plain-text
 * excerpt in card / list views without rendering literal `#`, `**`, etc.
 * Intentionally narrow — handles headings, bold/italic, inline code, code
 * fences, list bullets, blockquotes, and link/image syntax. Not a full
 * Markdown parser; safe for short excerpts where the detail view does the
 * real rendering.
 */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/^>\s?/gm, "") // blockquote markers
    .replace(/^#{1,6}\s+/gm, "") // ATX headings
    .replace(/^\s*[-*+]\s+/gm, "") // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/__([^_]+)__/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/_([^_]+)_/g, "$1") // italic
    .replace(/~~([^~]+)~~/g, "$1") // strikethrough
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date only (no time) — e.g. "Jul 2, 2026". Used where a countdown is primary. */
export function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
