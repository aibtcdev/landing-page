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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
